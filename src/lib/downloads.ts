import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"
import { r2DownloadUrl, r2DownloadUrls } from "@/lib/storage"
import {
  VAULT_RESCUE_PROOF_CODE,
  VAULT_RESCUE_USER_AGENT,
} from "@/lib/vault-rescue-constants"

// Download delivery. Two paths:
//  - On-page: the fan holds their submission's status_token; a route swaps it
//    for a short-lived signed URL (bounded by MAX_STATUS_DOWNLOADS).
//  - Email: we mint a download token (raw token in the email, only its hash
//    stored) with expiry + use limit; /download/[token] redeems it.

export const SIGNED_URL_TTL_SECONDS = 300
export const EMAIL_TOKEN_TTL_HOURS = 72
export const EMAIL_TOKEN_MAX_USES = 5
export const MAX_STATUS_DOWNLOADS = 10

/**
 * A fan can download once approved, or once unlocked while a screenshot check
 * is still open. A rejection (by the AI or the creator) ends access.
 */
export function hasDownloadAccess(submission: {
  status: string
  unlocked_at: string | null
}): boolean {
  if (submission.status === "approved") return true
  return (
    !!submission.unlocked_at &&
    (submission.status === "verifying" || submission.status === "needs_review")
  )
}

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
    .select("id, gate_id, status, unlocked_at, gates(creator_id)")
    .eq("id", submissionId)
    .maybeSingle()
  if (!submission || !hasDownloadAccess(submission)) {
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

export type VaultFile = { title: string; filename: string; url: string }

/**
 * Vault delivery: given an approved vault submission's status token, returns a
 * freshly-signed download link for every HQ file the creator has flagged into
 * the vault (every published `in_vault` single gate). Returns null if the token
 * isn't an unlocked vault submission.
 */
export async function getVaultDownloads(
  statusToken: string
): Promise<VaultFile[] | null> {
  const admin = createAdminClient()

  const { data: submission, error: submissionError } = await admin
    .from("submissions")
    .select(
      "id, gate_id, status, unlocked_at, proof_code, user_agent, gates(creator_id, kind, status)"
    )
    .eq("status_token", statusToken)
    .maybeSingle()
  if (submissionError) {
    throw new Error(`Couldn't load the vault grant: ${submissionError.message}`)
  }
  if (!submission || !hasDownloadAccess(submission)) return null
  const vaultGate = submission.gates as unknown as {
    creator_id: string
    kind: string
    status: string
  }
  if (vaultGate.kind !== "vault" || vaultGate.status !== "published") return null

  const { data: gates, error: gatesError } = await admin
    .from("gates")
    .select(
      "title, created_at, download_assets(storage_path, filename, storage_provider)"
    )
    .eq("creator_id", vaultGate.creator_id)
    .eq("kind", "single")
    .eq("in_vault", true)
    .eq("status", "published")
    .order("created_at", { ascending: false })
  if (gatesError) {
    throw new Error(`Couldn't load the vault files: ${gatesError.message}`)
  }

  const assets: {
    title: string
    filename: string
    storagePath: string
    storageProvider: string
  }[] = []
  for (const g of gates ?? []) {
    // download_assets is one-per-gate, so PostgREST may embed it as an object
    // (to-one) or array depending on constraints — handle both.
    const da = g.download_assets as unknown
    const asset = (Array.isArray(da) ? da[0] : da) as
      | { storage_path: string; filename: string; storage_provider: string }
      | undefined
    if (!asset) continue
    assets.push({
      title: g.title,
      filename: asset.filename,
      storagePath: asset.storage_path,
      storageProvider: asset.storage_provider,
    })
  }

  const urls: (string | null)[] = assets.map(() => null)
  const r2Indexes = assets.flatMap((asset, index) =>
    asset.storageProvider === "r2" ? [index] : []
  )
  const supabaseIndexes = assets.flatMap((asset, index) =>
    asset.storageProvider === "r2" ? [] : [index]
  )

  await Promise.all([
    r2DownloadUrls(
      vaultGate.creator_id,
      r2Indexes.map((index) => ({
        key: assets[index].storagePath,
        filename: assets[index].filename,
      }))
    ).then((signed) => {
      signed.forEach((url, i) => {
        urls[r2Indexes[i]] = url
      })
    }),
    (async () => {
      if (supabaseIndexes.length === 0) return
      const { data: signed, error: signError } = await admin.storage
        .from("hq-files")
        .createSignedUrls(
          supabaseIndexes.map((index) => assets[index].storagePath),
          SIGNED_URL_TTL_SECONDS
        )
      if (signError || !signed) {
        throw new Error(
          `Couldn't sign vault files: ${signError?.message ?? "empty response"}`
        )
      }
      const indexByPath = new Map(
        supabaseIndexes.map((index) => [assets[index].storagePath, index])
      )
      signed.forEach((item) => {
        if (item.error || !item.signedUrl || !item.path) {
          throw new Error(
            `Couldn't sign vault file: ${item.error ?? item.path ?? "unknown path"}`
          )
        }
        const index = indexByPath.get(item.path)
        if (index === undefined) {
          throw new Error(`Storage returned an unexpected vault path: ${item.path}`)
        }
        const separator = item.signedUrl.includes("?") ? "&" : "?"
        urls[index] = `${item.signedUrl}${separator}download=${encodeURIComponent(
          assets[index].filename
        )}`
      })
    })(),
  ])

  if (urls.some((url) => !url)) {
    throw new Error("Couldn't sign every vault file")
  }

  const files = assets.flatMap((asset, index) =>
    urls[index]
      ? [{ title: asset.title, filename: asset.filename, url: urls[index] }]
      : []
  ) as VaultFile[]

  // Rescue links are operational fallbacks, not fan conversions. Counting
  // their page loads would inflate the artist's download analytics.
  const isRescue =
    submission.proof_code === VAULT_RESCUE_PROOF_CODE &&
    submission.user_agent === VAULT_RESCUE_USER_AGENT
  if (!isRescue && files.length > 0) {
    await admin.from("events").insert({
      gate_id: submission.gate_id,
      submission_id: submission.id,
      event_type: "download",
    })
  }

  return files
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
