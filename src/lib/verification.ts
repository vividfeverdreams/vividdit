import "server-only"

import { getDecryptedOpenAiKey } from "@/lib/ai-keys"
import { mintDownloadToken } from "@/lib/downloads"
import { sendDownloadEmail } from "@/lib/email"
import { createAdminClient } from "@/lib/supabase/admin"

// AI screenshot verification. Runs server-side only, with the creator's own
// (decrypted) OpenAI key. Images go to OpenAI as base64 — local/private
// storage URLs aren't reachable from outside.

export type VerificationOutcome = {
  decision: "approve" | "reject" | "review"
  confidence: number
  track_match: boolean
  artist_match: boolean
  like_confirmed: boolean
  repost_confirmed: boolean
  follow_confirmed: boolean
  instagram_follow_confirmed: boolean
  spotify_follow_confirmed: boolean
  proof_code_visible: boolean
  tampering_suspected: boolean
  missing_requirements: string[]
  fan_message: string
}

const OUTCOME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approve", "reject", "review"] },
    confidence: {
      type: "number",
      description: "0–1 confidence in the decision",
    },
    track_match: { type: "boolean" },
    artist_match: { type: "boolean" },
    like_confirmed: { type: "boolean" },
    repost_confirmed: { type: "boolean" },
    follow_confirmed: {
      type: "boolean",
      description: "SoundCloud follow confirmed",
    },
    instagram_follow_confirmed: { type: "boolean" },
    spotify_follow_confirmed: { type: "boolean" },
    proof_code_visible: { type: "boolean" },
    tampering_suspected: { type: "boolean" },
    missing_requirements: { type: "array", items: { type: "string" } },
    fan_message: {
      type: "string",
      description:
        "One or two sentences for the fan: what's missing or why it was rejected. Empty when approving.",
    },
  },
  required: [
    "decision",
    "confidence",
    "track_match",
    "artist_match",
    "like_confirmed",
    "repost_confirmed",
    "follow_confirmed",
    "instagram_follow_confirmed",
    "spotify_follow_confirmed",
    "proof_code_visible",
    "tampering_suspected",
    "missing_requirements",
    "fan_message",
  ],
} as const

type VerificationCriteria = {
  title: string
  artist: string
  trackUrl: string
  artistProfileUrl: string | null
  requireLike: boolean
  requireRepost: boolean
  requireFollow: boolean
  requireInstagram: boolean
  instagramUrl: string | null
  requireSpotify: boolean
  spotifyUrl: string | null
  proofCode: string | null
}

function buildPrompt(ctx: VerificationCriteria, imageLabels: string[]): string {
  const required = [
    ctx.requireLike && "LIKE the track on SoundCloud (red/active heart on the track page)",
    ctx.requireRepost && "REPOST the track on SoundCloud (active repost icon)",
    ctx.requireFollow &&
      `FOLLOW ${ctx.artist} on SoundCloud (button shows “Following” on the artist card or profile)`,
    ctx.requireInstagram &&
      `FOLLOW the artist on Instagram at ${ctx.instagramUrl ?? "their profile"} (profile shows “Following”)`,
    ctx.requireSpotify &&
      `FOLLOW the artist on Spotify at ${ctx.spotifyUrl ?? "their profile"} (artist page shows “Following”)`,
  ]
    .filter(Boolean)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n")

  return `You verify fan-submitted screenshots for a music download gate.

Target track: "${ctx.title}" by ${ctx.artist}
SoundCloud track URL: ${ctx.trackUrl}
SoundCloud artist profile: ${ctx.artistProfileUrl ?? "unknown"}
Instagram profile: ${ctx.instagramUrl ?? "n/a"}
Spotify profile: ${ctx.spotifyUrl ?? "n/a"}

The fan must prove they did ALL of these:
${required}

The uploaded screenshots, in order:
${imageLabels.map((l, i) => `- Image ${i + 1}: ${l} proof`).join("\n")}

${
  ctx.proofCode
    ? `Expected proof code (SoundCloud only): ${ctx.proofCode}
Fans were asked to type this code into the SoundCloud track's comment box
before screenshotting. A visible matching code is strong evidence the
SoundCloud screenshot is fresh and theirs. A missing code lowers confidence
but is NOT a failure on its own.`
    : `No proof code was requested — set proof_code_visible to false and do not
penalize its absence.`
}

Evaluate each screenshot against ITS platform:
- Is it really that platform (SoundCloud / Instagram / Spotify, web or app)?
  Wrong platform → that action is not confirmed.
- Right track/artist/profile? Wrong target → not confirmed.
- Is each required action visibly in its done state (filled heart, active
  repost, “Following”)? Anything not clearly shown goes in missing_requirements.
- Set the matching *_confirmed boolean true ONLY when clearly shown. Set
  confirmed booleans for actions that are not required to false.
- tampering_suspected: edited pixels, inconsistent fonts/UI, stitched images,
  AI-generated content, or a screenshot of a screenshot.

Decide:
- "approve" only when every REQUIRED action is clearly confirmed.
- "reject" only for obvious failures: wrong platforms, wrong artist/track, or
  none of the required proof present.
- "review" for everything in between (partial proof, blur, ambiguity).

fan_message: short, friendly, specific — tell the fan exactly what to redo.
The screenshots follow.`
}

type RunResult = {
  decision: string
  confidence: number | null
  outcome: VerificationOutcome | null
  error: string | null
}

/**
 * Server-side decision policy — the model proposes, this disposes.
 * Pure so the matrix is unit-testable.
 */
export function decideFinalStatus(
  outcome: VerificationOutcome | null,
  required: {
    like: boolean
    repost: boolean
    follow: boolean
    instagram?: boolean
    spotify?: boolean
  },
  fraudFlags: string[]
): "approved" | "rejected" | "needs_review" {
  let finalStatus: "approved" | "rejected" | "needs_review" = "needs_review"

  if (outcome) {
    const allConfirmed =
      (!required.like || outcome.like_confirmed) &&
      (!required.repost || outcome.repost_confirmed) &&
      (!required.follow || outcome.follow_confirmed) &&
      (!required.instagram || outcome.instagram_follow_confirmed) &&
      (!required.spotify || outcome.spotify_follow_confirmed)

    if (
      outcome.decision === "approve" &&
      outcome.confidence >= 0.9 &&
      allConfirmed &&
      !outcome.tampering_suspected
    ) {
      finalStatus = "approved"
    } else if (outcome.decision === "reject" && outcome.confidence >= 0.8) {
      finalStatus = "rejected"
    }
  }

  // Fraud signals veto auto-approval — the creator gets the final call.
  if (finalStatus === "approved" && fraudFlags.length > 0) {
    finalStatus = "needs_review"
  }

  return finalStatus
}

export async function runVerification(submissionId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: submission } = await admin
    .from("submissions")
    .select(
      "id, gate_id, status, proof_code, email, fraud_flags, gates(creator_id, title, artist, soundcloud_url, instagram_url, spotify_url)"
    )
    .eq("id", submissionId)
    .maybeSingle()
  if (!submission || submission.status !== "pending") return

  const gate = submission.gates as unknown as {
    creator_id: string
    title: string
    artist: string
    soundcloud_url: string
    instagram_url: string | null
    spotify_url: string | null
  }

  const [{ data: req }, { data: profile }, { data: proofs }] =
    await Promise.all([
      admin
        .from("gate_requirements")
        .select(
          "require_like, require_repost, require_follow, require_proof_code, soundcloud_enabled, instagram_enabled, spotify_enabled"
        )
        .eq("gate_id", submission.gate_id)
        .single(),
      admin
        .from("profiles")
        .select("soundcloud_profile_url")
        .eq("id", gate.creator_id)
        .single(),
      admin
        .from("proof_images")
        .select("storage_path, platform")
        .eq("submission_id", submissionId)
        .order("created_at", { ascending: true }),
    ])

  const socialEnabled =
    !!req &&
    (req.soundcloud_enabled || req.instagram_enabled || req.spotify_enabled)
  if (!socialEnabled || !proofs?.length) return

  await admin
    .from("submissions")
    .update({ status: "verifying" })
    .eq("id", submissionId)

  const criteria: VerificationCriteria = {
    title: gate.title,
    artist: gate.artist,
    trackUrl: gate.soundcloud_url,
    artistProfileUrl: profile?.soundcloud_profile_url ?? null,
    requireLike: req.require_like,
    requireRepost: req.require_repost,
    requireFollow: req.require_follow,
    requireInstagram: req.instagram_enabled,
    instagramUrl: gate.instagram_url,
    requireSpotify: req.spotify_enabled,
    spotifyUrl: gate.spotify_url,
    proofCode: req.require_proof_code ? submission.proof_code : null,
  }

  const stored = await getDecryptedOpenAiKey(gate.creator_id)

  let result: RunResult
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  let model = stored?.model ?? "unknown"

  if (!stored) {
    result = {
      decision: "review",
      confidence: null,
      outcome: null,
      error: "Creator has no OpenAI key configured.",
    }
  } else {
    try {
      const images: string[] = []
      const labels: string[] = []
      for (const p of proofs) {
        const { data: blob, error } = await admin.storage
          .from("proofs")
          .download(p.storage_path)
        if (error || !blob) throw new Error("Couldn't load proof image")
        const ext = p.storage_path.split(".").pop()
        const mime =
          ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
        images.push(
          `data:${mime};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`
        )
        labels.push(p.platform ?? "SoundCloud")
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
                { type: "input_text", text: buildPrompt(criteria, labels) },
                ...images.map((url) => ({
                  type: "input_image",
                  image_url: url,
                })),
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
          max_output_tokens: 2000,
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

      const outcome = JSON.parse(text) as VerificationOutcome
      result = {
        decision: outcome.decision,
        confidence: outcome.confidence,
        outcome,
        error: null,
      }
    } catch (err) {
      result = {
        decision: "review",
        confidence: null,
        outcome: null,
        error: err instanceof Error ? err.message : "Verification failed",
      }
    }
  }

  const finalStatus = decideFinalStatus(
    result.outcome,
    {
      like: criteria.requireLike,
      repost: criteria.requireRepost,
      follow: criteria.requireFollow,
      instagram: criteria.requireInstagram,
      spotify: criteria.requireSpotify,
    },
    (submission.fraud_flags as string[]) ?? []
  )

  await admin.from("verification_runs").insert({
    submission_id: submissionId,
    provider: "openai",
    model,
    criteria,
    result: result.outcome,
    decision:
      finalStatus === "approved"
        ? "approve"
        : finalStatus === "rejected"
          ? "reject"
          : "review",
    confidence: result.confidence,
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    error: result.error,
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

  // Fans who closed the tab still get their file: email a tokenized link on
  // auto-approve when we have an address.
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
