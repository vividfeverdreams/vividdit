import "server-only"

import { decryptSecret, encryptSecret } from "@/lib/crypto"
import { createAdminClient } from "@/lib/supabase/admin"

// BYOK Resend keys. All access via the service-role client — the table has no
// client-side grants. Callers authenticate the creator first.

export type EmailKeyInfo = {
  keyHint: string | null
  fromEmail: string
  keyStatus: "untested" | "valid" | "invalid"
  lastTestedAt: string | null
  lastError: string | null
}

export function emailDomain(fromEmail: string): string | null {
  // Accepts "Name <user@domain>" or "user@domain".
  const match = fromEmail.match(/<([^>]+)>/)
  const addr = (match ? match[1] : fromEmail).trim()
  const at = addr.lastIndexOf("@")
  return at === -1 ? null : addr.slice(at + 1).toLowerCase()
}

export async function getEmailKeyInfo(
  creatorId: string
): Promise<EmailKeyInfo | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_email_keys")
    .select("key_hint, from_email, key_status, last_tested_at, last_error")
    .eq("creator_id", creatorId)
    .eq("provider", "resend")
    .maybeSingle()

  if (!data) return null
  return {
    keyHint: data.key_hint,
    fromEmail: data.from_email,
    keyStatus: data.key_status,
    lastTestedAt: data.last_tested_at,
    lastError: data.last_error,
  }
}

export async function saveResendKey(
  creatorId: string,
  rawKey: string,
  fromEmail: string
) {
  const admin = createAdminClient()
  const hint = `re_…${rawKey.slice(-4)}`
  const { error } = await admin.from("creator_email_keys").upsert(
    {
      creator_id: creatorId,
      provider: "resend",
      encrypted_key: encryptSecret(rawKey),
      from_email: fromEmail,
      key_hint: hint,
      key_status: "untested",
      last_tested_at: null,
      last_error: null,
    },
    { onConflict: "creator_id,provider" }
  )
  if (error) throw new Error(error.message)
}

export async function removeResendKey(creatorId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from("creator_email_keys")
    .delete()
    .eq("creator_id", creatorId)
    .eq("provider", "resend")
  if (error) throw new Error(error.message)
}

/** Decrypts the creator's Resend key + sender. Server-side send/test only. */
export async function getDecryptedResendKey(
  creatorId: string
): Promise<{ key: string; from: string } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_email_keys")
    .select("encrypted_key, from_email, key_status")
    .eq("creator_id", creatorId)
    .eq("provider", "resend")
    .maybeSingle()
  if (!data) return null
  return { key: decryptSecret(data.encrypted_key), from: data.from_email }
}

/**
 * Validates the key against the Resend API and checks that the configured
 * sender domain is verified (or the resend.dev sandbox). Persists + returns
 * the result.
 */
export async function testResendKey(
  creatorId: string
): Promise<EmailKeyInfo | null> {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from("creator_email_keys")
    .select("encrypted_key, from_email")
    .eq("creator_id", creatorId)
    .eq("provider", "resend")
    .maybeSingle()
  if (!row) return null

  const key = decryptSecret(row.encrypted_key)
  const domain = emailDomain(row.from_email)
  let keyStatus: "valid" | "invalid" = "invalid"
  let lastError: string | null = null

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string
      } | null
      lastError = body?.message ?? `Resend returned HTTP ${res.status}`
    } else if (!domain) {
      lastError = "Sender address is invalid — use name@yourdomain.com."
    } else if (domain === "resend.dev") {
      // Sandbox: works, but only delivers to the account owner's email.
      keyStatus = "valid"
      lastError =
        "Sandbox sender — only reaches your own Resend account email. Verify a domain to email fans."
    } else {
      const body = (await res.json()) as {
        data?: { name: string; status: string }[]
      }
      const verified = (body.data ?? [])
        .filter((d) => d.status === "verified")
        .map((d) => d.name.toLowerCase())
      if (verified.includes(domain)) {
        keyStatus = "valid"
      } else {
        lastError = `Key works, but "${domain}" isn't a verified domain in this Resend account. Verify it (or use onboarding@resend.dev for testing).`
      }
    }
  } catch (err) {
    lastError =
      err instanceof Error && err.name === "TimeoutError"
        ? "Resend API timed out"
        : "Could not reach the Resend API"
  }

  await admin
    .from("creator_email_keys")
    .update({
      key_status: keyStatus,
      last_tested_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq("creator_id", creatorId)
    .eq("provider", "resend")

  return getEmailKeyInfo(creatorId)
}
