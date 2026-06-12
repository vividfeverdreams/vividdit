import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret, encryptSecret } from "@/lib/crypto"

// All access to creator_ai_keys goes through this module with the
// service-role client — the table has no client-side grants. Callers are
// responsible for authenticating the creator first.

export const VERIFICATION_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4",
  "gpt-5.5",
] as const
export type VerificationModel = (typeof VERIFICATION_MODELS)[number]
export const DEFAULT_VERIFICATION_MODEL: VerificationModel = "gpt-5.4-mini"

export type AiKeyInfo = {
  keyHint: string | null
  keyStatus: "untested" | "valid" | "invalid"
  model: string
  lastTestedAt: string | null
  lastError: string | null
}

export async function getAiKeyInfo(creatorId: string): Promise<AiKeyInfo | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_ai_keys")
    .select("key_hint, key_status, model, last_tested_at, last_error")
    .eq("creator_id", creatorId)
    .eq("provider", "openai")
    .maybeSingle()

  if (!data) return null
  return {
    keyHint: data.key_hint,
    keyStatus: data.key_status,
    model: data.model,
    lastTestedAt: data.last_tested_at,
    lastError: data.last_error,
  }
}

export async function saveOpenAiKey(creatorId: string, rawKey: string) {
  const admin = createAdminClient()
  const hint = `sk-…${rawKey.slice(-4)}`
  const { error } = await admin.from("creator_ai_keys").upsert(
    {
      creator_id: creatorId,
      provider: "openai",
      encrypted_key: encryptSecret(rawKey),
      key_hint: hint,
      key_status: "untested",
      last_tested_at: null,
      last_error: null,
    },
    { onConflict: "creator_id,provider" }
  )
  if (error) throw new Error(error.message)
}

export async function removeOpenAiKey(creatorId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from("creator_ai_keys")
    .delete()
    .eq("creator_id", creatorId)
    .eq("provider", "openai")
  if (error) throw new Error(error.message)
}

export async function setVerificationModel(creatorId: string, model: VerificationModel) {
  const admin = createAdminClient()
  const { error } = await admin
    .from("creator_ai_keys")
    .update({ model })
    .eq("creator_id", creatorId)
    .eq("provider", "openai")
  if (error) throw new Error(error.message)
}

/** Decrypts the creator's key. Server-side verification/test use only. */
export async function getDecryptedOpenAiKey(
  creatorId: string
): Promise<{ key: string; model: string } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_ai_keys")
    .select("encrypted_key, model")
    .eq("creator_id", creatorId)
    .eq("provider", "openai")
    .maybeSingle()
  if (!data) return null
  return { key: decryptSecret(data.encrypted_key), model: data.model }
}

/**
 * Validates the stored key against the OpenAI API (zero-token request) and
 * persists the result. Returns the updated status.
 */
export async function testOpenAiKey(creatorId: string): Promise<AiKeyInfo | null> {
  const admin = createAdminClient()
  const stored = await getDecryptedOpenAiKey(creatorId)
  if (!stored) return null

  let keyStatus: "valid" | "invalid" = "invalid"
  let lastError: string | null = null

  try {
    // Retrieving the configured model validates both the key and that the
    // key's project has access to that model — without spending tokens.
    const res = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(stored.model)}`,
      {
        headers: { Authorization: `Bearer ${stored.key}` },
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (res.ok) {
      keyStatus = "valid"
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      lastError =
        body?.error?.message ?? `OpenAI returned HTTP ${res.status}`
      // 404 on the model with a working key means the model id is wrong /
      // not available to this project — surface that distinctly.
      if (res.status === 404) {
        lastError = `Key works, but model "${stored.model}" is not available to it: ${lastError}`
      }
    }
  } catch (err) {
    lastError =
      err instanceof Error && err.name === "TimeoutError"
        ? "OpenAI API timed out"
        : "Could not reach the OpenAI API"
  }

  await admin
    .from("creator_ai_keys")
    .update({
      key_status: keyStatus,
      last_tested_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq("creator_id", creatorId)
    .eq("provider", "openai")

  return getAiKeyInfo(creatorId)
}

/** Phase 4+ publish guard: SoundCloud (AI) gates need a valid key. */
export async function hasValidOpenAiKey(creatorId: string): Promise<boolean> {
  const info = await getAiKeyInfo(creatorId)
  return info?.keyStatus === "valid"
}
