import "server-only"

import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_VERIFICATION_MODEL,
  VERIFICATION_MODELS,
  isValidOpenRouterModel,
  providerFromKey,
  type AiProvider,
  type VerificationModel,
} from "@/lib/ai-models"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret, encryptSecret } from "@/lib/crypto"

// All access to creator_ai_keys goes through this module with the
// service-role client — the table has no client-side grants. Callers are
// responsible for authenticating the creator first.
//
// One verification key per creator. The provider is either OpenAI (Responses
// API) or OpenRouter (OpenAI-compatible Chat Completions API). Switching
// providers replaces the row (delete-then-insert), since the unique constraint
// is (creator_id, provider) but the product allows only one key per creator.

export {
  VERIFICATION_MODELS,
  DEFAULT_VERIFICATION_MODEL,
  OPENROUTER_SUGGESTED_MODELS,
  DEFAULT_OPENROUTER_MODEL,
} from "@/lib/ai-models"
export type { VerificationModel, AiProvider } from "@/lib/ai-models"

export type AiKeyInfo = {
  provider: AiProvider
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
    .select("provider, key_hint, key_status, model, last_tested_at, last_error")
    .eq("creator_id", creatorId)
    .maybeSingle()

  if (!data) return null
  return {
    provider: (data.provider as AiProvider) ?? "openai",
    keyHint: data.key_hint,
    keyStatus: data.key_status,
    model: data.model,
    lastTestedAt: data.last_tested_at,
    lastError: data.last_error,
  }
}

export async function saveAiKey(creatorId: string, rawKey: string) {
  const admin = createAdminClient()
  const provider = providerFromKey(rawKey)
  const hint =
    provider === "openrouter"
      ? `sk-or-…${rawKey.slice(-4)}`
      : `sk-…${rawKey.slice(-4)}`
  const model =
    provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : DEFAULT_VERIFICATION_MODEL

  // One verification key per creator — clear any prior key (either provider).
  await admin.from("creator_ai_keys").delete().eq("creator_id", creatorId)
  const { error } = await admin.from("creator_ai_keys").insert({
    creator_id: creatorId,
    provider,
    encrypted_key: encryptSecret(rawKey),
    key_hint: hint,
    model,
    key_status: "untested",
    last_tested_at: null,
    last_error: null,
  })
  if (error) throw new Error(error.message)
}

export async function removeAiKey(creatorId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from("creator_ai_keys")
    .delete()
    .eq("creator_id", creatorId)
  if (error) throw new Error(error.message)
}

export async function setVerificationModel(creatorId: string, model: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_ai_keys")
    .select("provider")
    .eq("creator_id", creatorId)
    .maybeSingle()
  if (!data) throw new Error("No key saved yet.")

  const provider = (data.provider as AiProvider) ?? "openai"
  if (provider === "openai") {
    if (!VERIFICATION_MODELS.includes(model as VerificationModel)) {
      throw new Error("Unknown model.")
    }
  } else if (!isValidOpenRouterModel(model)) {
    throw new Error(
      "Enter a valid OpenRouter model id, e.g. openai/gpt-4o-mini."
    )
  }

  const { error } = await admin
    .from("creator_ai_keys")
    .update({ model: model.trim() })
    .eq("creator_id", creatorId)
  if (error) throw new Error(error.message)
}

/** Decrypts the creator's key. Server-side verification/test use only. */
export async function getDecryptedAiKey(
  creatorId: string
): Promise<{ key: string; model: string; provider: AiProvider } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_ai_keys")
    .select("encrypted_key, model, provider")
    .eq("creator_id", creatorId)
    .maybeSingle()
  if (!data) return null
  return {
    key: decryptSecret(data.encrypted_key),
    model: data.model,
    provider: (data.provider as AiProvider) ?? "openai",
  }
}

async function validateOpenAiKey(
  key: string,
  model: string
): Promise<{ ok: boolean; error: string | null }> {
  // Retrieving the configured model validates both the key and that the key's
  // project has access to that model — without spending tokens.
  const res = await fetch(
    `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (res.ok) return { ok: true, error: null }
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
  let error = body?.error?.message ?? `OpenAI returned HTTP ${res.status}`
  if (res.status === 404) {
    error = `Key works, but model "${model}" is not available to it: ${error}`
  }
  return { ok: false, error }
}

async function validateOpenRouterKey(
  key: string,
  model: string
): Promise<{ ok: boolean; error: string | null }> {
  // Validate the key itself (zero-cost): /api/v1/key returns key metadata.
  const keyRes = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!keyRes.ok) {
    const body = (await keyRes.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    return {
      ok: false,
      error: body?.error?.message ?? `OpenRouter returned HTTP ${keyRes.status}`,
    }
  }

  // Key is valid — confirm the chosen model exists on OpenRouter (public list).
  try {
    const modelsRes = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(15_000),
    })
    if (modelsRes.ok) {
      const body = (await modelsRes.json()) as { data?: { id?: string }[] }
      const known = (body.data ?? []).some((m) => m.id === model)
      if (!known) {
        return {
          ok: false,
          error: `Key works, but model "${model}" was not found on OpenRouter. Use a model id from openrouter.ai/models.`,
        }
      }
    }
  } catch {
    // Couldn't fetch the model list — don't fail the key on that alone.
  }
  return { ok: true, error: null }
}

/**
 * Validates the stored key against its provider's API and persists the result.
 */
export async function testAiKey(creatorId: string): Promise<AiKeyInfo | null> {
  const admin = createAdminClient()
  const stored = await getDecryptedAiKey(creatorId)
  if (!stored) return null

  let keyStatus: "valid" | "invalid" = "invalid"
  let lastError: string | null = null

  try {
    const result =
      stored.provider === "openrouter"
        ? await validateOpenRouterKey(stored.key, stored.model)
        : await validateOpenAiKey(stored.key, stored.model)
    keyStatus = result.ok ? "valid" : "invalid"
    lastError = result.error
  } catch (err) {
    const name = stored.provider === "openrouter" ? "OpenRouter" : "OpenAI"
    lastError =
      err instanceof Error && err.name === "TimeoutError"
        ? `${name} API timed out`
        : `Could not reach the ${name} API`
  }

  await admin
    .from("creator_ai_keys")
    .update({
      key_status: keyStatus,
      last_tested_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq("creator_id", creatorId)

  return getAiKeyInfo(creatorId)
}

/** Phase 4+ publish guard: SoundCloud (AI) gates need a valid key. */
export async function hasValidAiKey(creatorId: string): Promise<boolean> {
  const info = await getAiKeyInfo(creatorId)
  return info?.keyStatus === "valid"
}
