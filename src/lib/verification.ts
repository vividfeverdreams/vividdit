import "server-only"

import { randomUUID } from "node:crypto"

import { getDecryptedAiKey, isKeyProblem } from "@/lib/ai-keys"
import type { AiProvider } from "@/lib/ai-models"
import { sendReviewNeededEmail } from "@/lib/email"
import { markAiKeyBroken } from "@/lib/key-health"
import { reviewUrl } from "@/lib/review-links"
import { createAdminClient } from "@/lib/supabase/admin"
import { completeApproval } from "@/lib/unlock"

// AI screenshot verification for Verified gates. The fan already has the
// download by the time this runs (they unlock as soon as their screenshots are
// in); the check decides whether that stands. The dispatch lease admits one
// paid worker at a time, and the model checks every required action against
// the full unordered screenshot set.

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

type Requirement = {
  label: string
  requirement: string
}

// Fails open: when the AI couldn't run at all (no key, no credits, provider
// down) the fan is approved and the submission is flagged for a later look.
// Repeat-email / repeat-network flags are notes for the creator, never a veto;
// an exact duplicate screenshot is already refused at upload.
export function decideFinalStatus(
  outcome: VerificationOutcome | null,
  expectedCount: number
): "approved" | "rejected" | "needs_review" {
  if (!outcome) return "approved"
  if (outcome.results.length !== expectedCount || expectedCount === 0) {
    return "needs_review"
  }

  const allConfirmed = outcome.results.every((r) => r.confirmed)
  const noneConfirmed = outcome.results.every((r) => !r.confirmed)

  if (allConfirmed && outcome.confidence >= 0.9 && !outcome.tampering_suspected) {
    return "approved"
  }
  if (
    outcome.tampering_suspected ||
    (noneConfirmed && outcome.confidence >= 0.8)
  ) {
    return "rejected"
  }
  return "needs_review"
}

function buildPrompt(
  requirements: Requirement[],
  ctx: { proofCode: string | null }
): string {
  const lines = requirements
    .map((r, i) => `${i + 1}. ${r.requirement}`)
    .join("\n")
  return `You verify fan-submitted screenshots for a music download gate. You are
given a SET of screenshots in NO PARTICULAR ORDER, and a numbered list of
requirements. For EACH requirement, decide whether AT LEAST ONE of the
screenshots clearly proves it was done. A single screenshot may satisfy more
than one requirement, and extra/unrelated screenshots are fine.

Return a "results" array with one entry per requirement, in the SAME order as
listed below, each {confirmed, note}.

Requirements:
${lines}

${
  ctx.proofCode
    ? `For the SoundCloud track requirement, fans were asked to type the code
"${ctx.proofCode}" into the comment box. A visible matching code is strong
evidence the screenshot is fresh; a missing code lowers confidence but is not
an automatic fail.`
    : ""
}

Set confirmed=true for a requirement only when at least one screenshot clearly
shows it: the right platform, the right profile/track, and the action in its
done state (red/active heart, active repost, or "Following" on the exact
profile named). Set confirmed=false if no screenshot shows it, or it's the
wrong platform/profile/track. tampering_suspected: any edited, stitched, or
AI-generated images, or a photo of another screen. fan_message: short,
friendly, specific — tell the fan exactly which steps are still missing.`
}

// Sends the verification request to the creator's provider and returns the raw
// structured-output JSON text + token usage. OpenAI uses the Responses API;
// OpenRouter uses the OpenAI-compatible Chat Completions API.
async function requestVerification(opts: {
  provider: AiProvider
  key: string
  model: string
  prompt: string
  images: string[]
}): Promise<{
  text: string
  usage: { input_tokens?: number; output_tokens?: number }
}> {
  const { provider, key, model, prompt, images } = opts

  if (provider === "openrouter") {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers (optional but recommended).
          "HTTP-Referer": "https://vividdit.com",
          "X-Title": "Vividdit",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                ...images.map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "gate_verification",
              strict: true,
              schema: OUTCOME_SCHEMA,
            },
          },
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(90_000),
      }
    )
    const body = await response.json()
    if (!response.ok) {
      throw new Error(
        body?.error?.message ?? `OpenRouter returned HTTP ${response.status}`
      )
    }
    const text: string | undefined = body.choices?.[0]?.message?.content
    if (!text) throw new Error("No structured output in model response")
    return {
      text,
      usage: {
        input_tokens: body.usage?.prompt_tokens,
        output_tokens: body.usage?.completion_tokens,
      },
    }
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
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
  const text: string | undefined = body.output
    ?.find((o: { type: string }) => o.type === "message")
    ?.content?.find((c: { type: string }) => c.type === "output_text")?.text
  if (!text) throw new Error("No structured output in model response")
  return { text, usage: body.usage ?? {} }
}

export async function runVerification(
  submissionId: string,
  statusToken: string
): Promise<void> {
  const admin = createAdminClient()
  const dispatchToken = randomUUID()
  let claimed = false

  // Claim before any Storage reads or paid AI work. A retry uses the same
  // caller-owned token, so a committed-but-lost RPC response is idempotent.
  // A different callback cannot take over until the three-minute lease is
  // older than the 90-second model timeout.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin.rpc(
      "claim_submission_verification_dispatch",
      {
        p_submission_id: submissionId,
        p_status_token: statusToken,
        p_dispatch_token: dispatchToken,
      }
    )
    if (!error) {
      claimed = data === true
      break
    }
    if (attempt === 1) {
      // If both RPC responses were lost after the database committed, prove
      // ownership through the same submission capability before giving up.
      const { data: persisted, error: readbackError } = await admin
        .from("submissions")
        .select("status, verification_dispatch_token")
        .eq("id", submissionId)
        .eq("status_token", statusToken)
        .maybeSingle()
      if (
        !readbackError &&
        persisted?.status === "verifying" &&
        persisted.verification_dispatch_token === dispatchToken
      ) {
        claimed = true
        break
      }
      console.error(
        "verification dispatch claim failed:",
        readbackError?.message ?? error.message
      )
      return
    }
  }
  if (!claimed) return

  const { data: submission } = await admin
    .from("submissions")
    .select(
      "id, gate_id, status, status_token, proof_code, email, fraud_flags, gates(creator_id, title, artist, soundcloud_url, kind)"
    )
    .eq("id", submissionId)
    .maybeSingle()
  // Completion/finalization transitions the submission to verifying before
  // scheduling this work. Recovery callbacks may race to this function, but
  // the dispatch-token lease above admits only one paid worker at a time. The
  // terminal compare-and-set below also gates user-visible events and delivery.
  if (!submission || submission.status !== "verifying") return

  const gate = submission.gates as unknown as {
    creator_id: string
    title: string
    artist: string
    soundcloud_url: string
    kind: string
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

  // The required actions, as a checklist. Each fan-uploaded screenshot is no
  // longer tagged to a specific requirement; instead the AI checks every
  // requirement against the whole set of screenshots (order-independent).
  const requirements: Requirement[] = []

  if (trackActions) {
    const actions = [
      req!.require_like && "LIKE the track (red/active heart)",
      req!.require_repost && "REPOST the track (active repost icon)",
    ]
      .filter(Boolean)
      .join(" and ")
    requirements.push({
      label: "SoundCloud track",
      requirement: `On the SoundCloud track "${gate.title}" by ${gate.artist}: ${actions}.`,
    })
  }

  for (const t of followTargets) {
    const who = t.display_name || t.profile_url
    requirements.push({
      label: `Follow ${who} (${t.platform})`,
      requirement: `FOLLOW ${who} on ${t.platform} (profile/page at ${t.profile_url} must show "Following").`,
    })
  }

  const proofCode = req?.require_proof_code ? submission.proof_code : null
  const stored = await getDecryptedAiKey(gate.creator_id)

  let outcome: VerificationOutcome | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  let error: string | null = null
  const model = stored?.model ?? "unknown"
  const provider: AiProvider = stored?.provider ?? "openai"

  if (!stored) {
    error = "Creator has no verification (AI) key configured."
  } else if (requirements.length === 0 || !proofs?.length) {
    error = "No screenshots to verify."
  } else {
    try {
      const images: string[] = []
      for (const p of proofs) {
        const { data: blob, error: dlErr } = await admin.storage
          .from("proofs")
          .download(p.storage_path)
        if (dlErr || !blob) throw new Error("Couldn't load proof image")
        const ext = p.storage_path.split(".").pop()
        const mime =
          ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
        images.push(
          `data:${mime};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`
        )
      }

      const { text, usage: tokenUsage } = await requestVerification({
        provider: stored.provider,
        key: stored.key,
        model: stored.model,
        prompt: buildPrompt(requirements, { proofCode }),
        images,
      })
      usage = tokenUsage

      const parsed = JSON.parse(text) as Omit<VerificationOutcome, "results"> & {
        results: { confirmed: boolean; note: string }[]
      }
      outcome = {
        results: parsed.results.map((r, i) => ({
          label: requirements[i]?.label ?? `Requirement ${i + 1}`,
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

  const finalStatus = decideFinalStatus(outcome, requirements.length)

  await admin.from("verification_runs").insert({
    submission_id: submissionId,
    provider,
    model,
    criteria: { items: requirements.map((r) => r.label), proofCode },
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

  const flags = ((submission.fraud_flags as string[]) ?? []).slice()
  if (error && !flags.includes("ai_unavailable")) flags.push("ai_unavailable")

  const now = new Date().toISOString()
  const { data: finalized, error: finalizeError } = await admin
    .from("submissions")
    .update({
      status: finalStatus,
      decided_at: finalStatus === "needs_review" ? null : now,
      fraud_flags: flags,
      ...(finalStatus === "needs_review" ? { review_started_at: now } : {}),
    })
    .eq("id", submissionId)
    .eq("status", "verifying")
    .select("id")
    .maybeSingle()

  if (finalizeError) {
    console.error("verification finalization failed:", finalizeError.message)
    return
  }
  // A creator decision, cleanup recovery, or another claimed worker may have
  // moved the row while the AI request was running. Only the worker that wins
  // the verifying -> terminal compare-and-set may emit events or deliver mail.
  if (!finalized) return

  if (error && stored && isKeyProblem(error)) {
    await markAiKeyBroken(admin, gate.creator_id, stored.id, stored.provider, error)
  }

  const unlockSubmission = {
    id: submissionId,
    gate_id: submission.gate_id,
    email: submission.email,
    status_token: submission.status_token,
  }

  if (finalStatus === "approved") {
    await completeApproval(admin, unlockSubmission, gate)
  } else if (finalStatus === "rejected") {
    await admin.from("events").insert({
      gate_id: submission.gate_id,
      submission_id: submissionId,
      event_type: "reject",
    })
  } else {
    const aiNote =
      outcome?.results.find((r) => !r.confirmed)?.note || outcome?.fan_message || null
    try {
      await sendReviewNeededEmail({
        creatorId: gate.creator_id,
        gateTitle: gate.title,
        fanEmail: submission.email,
        aiNote,
        reviewUrl: reviewUrl(submissionId),
      })
    } catch (err) {
      console.error("review email failed:", err)
    }
  }
}
