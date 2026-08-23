import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  getVaultDownloads,
  mintDownloadToken,
  redeemByStatusToken,
  redeemDownloadToken,
} from "@/lib/downloads"
import {
  VAULT_RESCUE_PROOF_CODE,
  VAULT_RESCUE_USER_AGENT,
} from "@/lib/vault-rescue-constants"

// Download delivery against the local stack: token redemption, expiry,
// use limits, signed URLs, and the private-bucket guarantee.

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY!

async function stackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${url()}/auth/v1/health`, {
      headers: { apikey: anonKey() },
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

const run = await stackUp()

describe.skipIf(!run)("download delivery", () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const storagePath = `dl-test/${suffix}/track.wav`
  const fileBytes = Buffer.from(`RIFF-test-content-${suffix}`)

  let admin: SupabaseClient
  let userId: string
  let submissionId: string
  let statusToken: string
  let vaultGateId: string
  let vaultStatusToken: string
  let rescueStatusToken: string

  beforeAll(async () => {
    admin = createClient(url(), serviceKey())

    const u = await admin.auth.admin.createUser({
      email: `dl-${suffix}@test.dev`,
      password: "test-password-123",
      email_confirm: true,
    })
    userId = u.data.user!.id

    const { data: gate } = await admin
      .from("gates")
      .insert({
        creator_id: userId,
        title: "DL Test",
        artist: "A",
        soundcloud_url: "https://soundcloud.com/a/dl",
        slug: `dl-${suffix}`,
        status: "published",
      })
      .select("id")
      .single()

    await admin.storage.from("hq-files").upload(storagePath, fileBytes, {
      contentType: "audio/wav",
    })
    await admin.from("download_assets").insert({
      gate_id: gate!.id,
      storage_path: storagePath,
      filename: "track.wav",
      size_bytes: fileBytes.length,
      mime_type: "audio/wav",
    })

    const { data: sub } = await admin
      .from("submissions")
      .insert({
        gate_id: gate!.id,
        proof_code: "GATE-DL",
        status: "approved",
        decided_at: new Date().toISOString(),
      })
      .select("id, status_token")
      .single()
    submissionId = sub!.id
    statusToken = sub!.status_token

    const { data: vault } = await admin
      .from("gates")
      .insert({
        creator_id: userId,
        kind: "vault",
        title: "DL Test Vault",
        artist: "A",
        soundcloud_url: "https://soundcloud.com/a",
        slug: `vault-${suffix}`,
        status: "published",
      })
      .select("id")
      .single()
    vaultGateId = vault!.id

    const { data: vaultSub } = await admin
      .from("submissions")
      .insert({
        gate_id: vaultGateId,
        proof_code: "GATE-VAULT",
        status: "approved",
        decided_at: new Date().toISOString(),
      })
      .select("status_token")
      .single()
    vaultStatusToken = vaultSub!.status_token

    const { data: rescueSub } = await admin
      .from("submissions")
      .insert({
        gate_id: vaultGateId,
        proof_code: VAULT_RESCUE_PROOF_CODE,
        status: "approved",
        user_agent: VAULT_RESCUE_USER_AGENT,
        decided_at: new Date().toISOString(),
      })
      .select("status_token")
      .single()
    rescueStatusToken = rescueSub!.status_token
  })

  afterAll(async () => {
    if (!admin) return
    await admin.storage.from("hq-files").remove([storagePath])
    await admin.auth.admin.deleteUser(userId).catch(() => {})
  })

  it("the private file is not directly accessible", async () => {
    const res = await fetch(
      `${url()}/storage/v1/object/public/hq-files/${storagePath}`
    )
    expect(res.ok).toBe(false)
  })

  it("a minted token redeems to a working signed URL", async () => {
    const raw = await mintDownloadToken(submissionId)
    const result = await redeemDownloadToken(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const res = await fetch(result.signedUrl)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(fileBytes.toString())
    }
  })

  it("tokens stop working after max uses", async () => {
    const raw = await mintDownloadToken(submissionId)
    for (let i = 0; i < 5; i++) {
      expect((await redeemDownloadToken(raw)).ok).toBe(true)
    }
    const exhausted = await redeemDownloadToken(raw)
    expect(exhausted).toEqual({ ok: false, reason: "exhausted" })
  })

  it("expired tokens are refused", async () => {
    const raw = await mintDownloadToken(submissionId)
    const { createHash } = await import("node:crypto")
    await admin
      .from("download_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("token_hash", createHash("sha256").update(raw).digest("hex"))
    expect(await redeemDownloadToken(raw)).toEqual({
      ok: false,
      reason: "expired",
    })
  })

  it("garbage tokens are refused", async () => {
    expect(await redeemDownloadToken("not-a-real-token")).toEqual({
      ok: false,
      reason: "not_found",
    })
  })

  it("the status token redeems for approved submissions", async () => {
    const result = await redeemByStatusToken(statusToken)
    expect(result.ok).toBe(true)
  })

  it("the status token stops working if the submission is not approved", async () => {
    await admin
      .from("submissions")
      .update({ status: "rejected" })
      .eq("id", submissionId)
    const result = await redeemByStatusToken(statusToken)
    expect(result.ok).toBe(false)
    await admin
      .from("submissions")
      .update({ status: "approved" })
      .eq("id", submissionId)
  })

  it("an approved vault token returns every included file", async () => {
    const files = await getVaultDownloads(vaultStatusToken)
    expect(files).toHaveLength(1)
    expect(files?.[0].filename).toBe("track.wav")
    const res = await fetch(files![0].url)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(fileBytes.toString())
  })

  it("rescue-link page loads do not inflate fan download analytics", async () => {
    const before = await admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("gate_id", vaultGateId)
      .eq("event_type", "download")
    expect(await getVaultDownloads(rescueStatusToken)).toHaveLength(1)
    const after = await admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("gate_id", vaultGateId)
      .eq("event_type", "download")
    expect(after.count).toBe(before.count)
  })

  it("vault links stop working when the artist disables the vault", async () => {
    await admin.from("gates").update({ status: "archived" }).eq("id", vaultGateId)
    expect(await getVaultDownloads(vaultStatusToken)).toBeNull()
    expect(await getVaultDownloads(rescueStatusToken)).toBeNull()
    await admin.from("gates").update({ status: "published" }).eq("id", vaultGateId)
  })
})
