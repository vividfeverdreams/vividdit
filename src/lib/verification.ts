import "server-only"

import { getDecryptedOpenAiKey } from "@/lib/ai-keys"
import { mintDownloadToken } from "@/lib/downloads"
import { sendDownloadEmail } from "@/lib/email"
import { createAdminClient } from "@/lib/supabase/admin"

// AI screenshot verification. One call per submission; each required item
// (the SoundCloud track actions, plus one per follow profile) maps to one
// screenshot, and the model returns a confirmed/result per item in order.

export type ItemResult = {
  label: string
  confirmed: boolean
  note: string
}

export type VerificationOutcome = {
  results: ItemResult[]
  tampering_suspected: boolean
  confidence: number
  fan_message: string
}

const OUTCOME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      description:
        "One entry per image, in the SAME order the images were provided.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          confirmed: {
            type: "boolean",
            description: "True only if the image clearly proves its requirement.",
          },
          note: {
            type: "string",
            description: "Short reason, especially when not confirmed.",
          },
        },
        required: ["confirmed", "note"],
      },
    },
    tampering_suspected: { type: "boolean" },
    confidence: { type: "number", description: "0–1 overall confidence" },
    fan_message: {
      type: "string",
      description:
        "One or two sentences for the fan: what's missing or why rejected. Empty when everything is confirmed.",
    },
  },
  required: ["results", "tampering_suspected", "confidence", "fan_message"],
} as const

type Item = {
  label: string
  requirement: string
  storagePath: string
}

export function decideFinalStatus(
  outcome: VerificationOutcome | null,
  expectedCount: number,
  fraudFlags: string[]
): "approved" | "rejected" | "needs_review" {
  if (!outcome || outcome.results.length !== expectedCount || expectedCount === 0) {
    return "needs_review"
  }

  const allConfirmed = outcome.results.every((r) => r.confirmed)
  const noneConfirmed = outcome.results.every((r) => !r.confirmed)

  let status: "approved" | "rejected" | "needs_review" = "needs_review"
  if (allConfirmed && outcome.confidence >= 0.9 && !outcome.tampering_suspected) {
    status = "approved"
  } else if (
    outcome.tampering_suspected ||
    (noneConfirmed && outcome.confidence >= 0.8)
  ) {
    status = "rejected"
  }

  // Fraud signals veto auto-approval — creator gets the final call.
  if (status === "approved" && fraudFlags.length > 0) status = "needs_review"
  return status
}

function buildPrompt(
  items: Item[],
  ctx: { proofCode: string | null }
): string {
  const lines = items
    .map((it, i) => `- Image ${i + 1}: ${it.requirement}`)
    .join("\n")
  return `You verify fan-submitted screenshots for a music download gate. Each
image proves one requirement. Return a "results" array with one entry per
image, in the SAME order, each {confirmed, note}.

Requirements (in image order):
${lines}

${
  ctx.proofCode
    ? `For the SoundCloud track image, fans were asked to type the code
"${ctx.proofCode}" into the comment box. A visible matching code is strong
evidence the screenshot is fresh; a missing code lowers confidence but is not
an automatic fail.`
    : ""
}

For each image: confirm it's really the right platform and shows the required
action in its done state (red/active heart, active repost, or "Following" on
the exact profile named). Set confirmed=false if it's the wrong platform,
wrong profile/track, or the action isn't clearly shown. tampering_suspected:
edited, stitched, or AI-generated images, or a photo of another screen.
fan_message: short, friendly, specific — tell the fan exactly what to redo.`
}

export async function runVerification(submissionId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: submission } = await admin
    .from("submissions")
    .select(
      "id, gate_id, status, proof_code, email, fraud_flags, gates(creator_id, title, artist, soundcloud_url)"
    )
    .eq("id", submissionId)
    .maybeSingle()
  if (!submission || submission.status !== "pending") return

  const gate = submission.gates as unknown as {
    creator_id: string
    title: string
    artist: string
    soundcloud_url: string
  }

  const [{ data: req }, { data: targets }, { data: proofs }] =
    await Promise.all([
      admin
        .from("gate_requirements")
        .select("require_like, require_repost, require_proof_code")
        .eq("gate_id", submission.gate_id)
        .single(),
      admin
        .from("gate_follow_targets")
        .select("id, platform, profile_url, display_name, sort_order")
        .eq("gate_id", submission.gate_id)
        .order("sort_order", { ascending: true }),
      admin
        .from("proof_images")
        .select("storage_path, platform, follow_target_id, created_at")
        .eq("submission_id", submissionId)
        .order("created_at", { ascending: true }),
    ])

  const trackActions = !!req && (req.require_like || req.require_repost)
  const followTargets = targets ?? []
  if ((!trackActions && followTargets.length === 0) || !proofs?.length) return

  await admin
    .from("submissions")
    .update({ status: "verifying" })
    .eq("id", submissionId)

  // Latest proof per requirement (handles resubmissions: newest wins).
  const latest = <T extends { created_at: string }>(arr: T[]) =>
    arr.length ? arr[arr.length - 1] : null

  const items: Item[] = []

  if (trackActions) {
    const actions = [
      req!.require_like && "LIKE the track (red/active heart)",
      req!.require_repost && "REPOST the track (active repost icon)",
    ]
      .filter(Boolean)
      .join(" and ")
    const trackProof = latest(proofs.filter((p) => !p.follow_target_id))
    items.push({
      label: "SoundCloud track",
      requirement: `On the SoundCloud track "${gate.title}" by ${gate.artist}: ${actions}.`,
      storagePath: trackProof?.storage_path ?? "",
    })
  }

  for (const t of followTargets) {
    const proof = latest(proofs.filter((p) => p.follow_target_id === t.id))
    const who = t.display_name || t.profile_url
    items.push({
      label: `Follow ${who} (${t.platform})`,
      requirement: `FOLLOW ${who} on ${t.platform} (profile/page at ${t.profile_url} must show "Following").`,
      storagePath: proof?.storage_path ?? "",
    })
  }

  const proofCode = req?.require_proof_code ? submission.proof_code : null
  const stored = await getDecryptedOpenAiKey(gate.creator_id)

  let outcome: VerificationOutcome | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  let error: string | null = null
  const model = stored?.model ?? "unknown"

  if (!stored) {
    error = "Creator has no OpenAI key configured."
  } else if (items.some((it) => !it.storagePath)) {
    error = "Some required screenshots are missing."
  } else {
    try {
      const images: string[] = []
      for (const it of items) {
        const { data: blob, error: dlErr } = await admin.storage
          .from("proofs")
          .download(it.storagePath)
        if (dlErr || !blob) throw new Error("Couldn't load proof image")
        const ext = it.storagePath.split(".").pop()
        const mime =
          ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
        images.push(
          `data:${mime};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`
        )
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stored.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: stored.model,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: buildPrompt(items, { proofCode }) },
                ...images.map((url) => ({ type: "input_image", image_url: url })),
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "gate_verification",
              strict: true,
              schema: OUTCOME_SCHEMA,
            },
          },
          max_output_tokens: 3000,
        }),
        signal: AbortSignal.timeout(90_000),
      })

      const body = await response.json()
      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? `OpenAI returned HTTP ${response.status}`
        )
      }
      usage = body.usage ?? {}
      const text: string | undefined = body.output
        ?.find((o: { type: string }) => o.type === "message")
        ?.content?.find((c: { type: string }) => c.type === "output_text")?.text
      if (!text) throw new Error("No structured output in model response")

      const parsed = JSON.parse(text) as Omit<VerificationOutcome, "results"> & {
        results: { confirmed: boolean; note: string }[]
      }
      outcome = {
        results: parsed.results.map((r, i) => ({
          label: items[i]?.label ?? `Item ${i + 1}`,
          confirmed: r.confirmed,
          note: r.note,
        })),
        tampering_suspected: parsed.tampering_suspected,
        confidence: parsed.confidence,
        fan_message: parsed.fan_message,
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Verification failed"
    }
  }

  const finalStatus = decideFinalStatus(
    outcome,
    items.length,
    (submission.fraud_flags as string[]) ?? []
  )

  await admin.from("verification_runs").insert({
    submission_id: submissionId,
    provider: "openai",
    model,
    criteria: { items: items.map((it) => it.label), proofCode },
    result: outcome,
    decision:
      finalStatus === "approved"
        ? "approve"
        : finalStatus === "rejected"
          ? "reject"
          : "review",
    confidence: outcome?.confidence ?? null,
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    error,
  })

  await admin
    .from("submissions")
    .update({
      status: finalStatus,
      decided_at: finalStatus === "needs_review" ? null : new Date().toISOString(),
    })
    .eq("id", submissionId)

  if (finalStatus !== "needs_review") {
    await admin.from("events").insert({
      gate_id: submission.gate_id,
      submission_id: submissionId,
      event_type: finalStatus === "approved" ? "approve" : "reject",
    })
  }

  if (finalStatus === "approved" && submission.email) {
    try {
      const token = await mintDownloadToken(submissionId)
      await sendDownloadEmail({
        creatorId: gate.creator_id,
        to: submission.email,
        gateTitle: gate.title,
        artist: gate.artist,
        downloadToken: token,
      })
    } catch (err) {
      console.error("download email failed:", err)
    }
  }
}
