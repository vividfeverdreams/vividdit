import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"
import { r2DownloadUrl } from "@/lib/storage"

// Download delivery. Two paths:
//  - On-page: the fan holds their submission's status_token; a route swaps it
//    for a short-lived signed URL (bounded by MAX_STATUS_DOWNLOADS).
//  - Email: we mint a download token (raw token in the email, only its hash
//    stored) with expiry + use limit; /download/[token] redeems it.

export const SIGNED_URL_TTL_SECONDS = 300
export const EMAIL_TOKEN_TTL_HOURS = 72
export const EMAIL_TOKEN_MAX_USES = 5
export const MAX_STATUS_DOWNLOADS = 10

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

export async function mintDownloadToken(submissionId: string): Promise<string> {
  const admin = createAdminClient()
  const raw = randomBytes(32).toString("base64url")
  const { error } = await admin.from("download_tokens").insert({
    submission_id: submissionId,
    token_hash: hashToken(raw),
    expires_at: new Date(
      Date.now() + EMAIL_TOKEN_TTL_HOURS * 3600 * 1000
    ).toISOString(),
    max_uses: EMAIL_TOKEN_MAX_USES,
  })
  if (error) throw new Error(error.message)
  return raw
}

type RedeemResult =
  | { ok: true; signedUrl: string }
  | { ok: false; reason: "not_found" | "expired" | "exhausted" | "unavailable" }

async function signedUrlForSubmission(
  submissionId: string
): Promise<RedeemResult> {
  const admin = createAdminClient()

  const { data: submission } = await admin
    .from("submissions")
    .select("id, gate_id, status, gates(creator_id)")
    .eq("id", submissionId)
    .maybeSingle()
  if (!submission || submission.status !== "approved") {
    return { ok: false, reason: "not_found" }
  }
  const gate = submission.gates as unknown as { creator_id: string }

  const { data: asset } = await admin
    .from("download_assets")
    .select("storage_path, filename, storage_provider")
    .eq("gate_id", submission.gate_id)
    .maybeSingle()
  if (!asset) return { ok: false, reason: "unavailable" }

  let downloadUrl: string | null = null
  if (asset.storage_provider === "r2") {
    // Hosted on the creator's own R2 bucket — presign a GET there.
    downloadUrl = await r2DownloadUrl(
      gate.creator_id,
      asset.storage_path,
      asset.filename
    )
  } else {
    const { data: signed } = await admin.storage
      .from("hq-files")
      .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS, {
        download: asset.filename,
      })
    downloadUrl = signed?.signedUrl ?? null
  }
  if (!downloadUrl) return { ok: false, reason: "unavailable" }

  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submission.id,
    event_type: "download",
  })

  return { ok: true, signedUrl: downloadUrl }
}

/** Email-link path: validate the token row, count a use, sign. */
export async function redeemDownloadToken(raw: string): Promise<RedeemResult> {
  const admin = createAdminClient()

  const { data: token } = await admin
    .from("download_tokens")
    .select("id, submission_id, expires_at, max_uses, use_count")
    .eq("token_hash", hashToken(raw))
    .maybeSingle()
  if (!token) return { ok: false, reason: "not_found" }
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" }
  }
  if (token.use_count >= token.max_uses) {
    return { ok: false, reason: "exhausted" }
  }

  await admin
    .from("download_tokens")
    .update({ use_count: token.use_count + 1 })
    .eq("id", token.id)

  return signedUrlForSubmission(token.submission_id)
}

/** On-page path: the status token is the capability; cap total downloads. */
export async function redeemByStatusToken(
  statusToken: string
): Promise<RedeemResult> {
  const admin = createAdminClient()

  const { data: submission } = await admin
    .from("submissions")
    .select("id")
    .eq("status_token", statusToken)
    .maybeSingle()
  if (!submission) return { ok: false, reason: "not_found" }

  const { count } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submission.id)
    .eq("event_type", "download")
  if ((count ?? 0) >= MAX_STATUS_DOWNLOADS) {
    return { ok: false, reason: "exhausted" }
  }

  return signedUrlForSubmission(submission.id)
}
