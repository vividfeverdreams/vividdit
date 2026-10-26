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
): Promise<{ id: string; key: string; model: string; provider: AiProvider } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_ai_keys")
    .select("id, encrypted_key, model, provider")
    .eq("creator_id", creatorId)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    key: decryptSecret(data.encrypted_key),
    model: data.model,
    provider: (data.provider as AiProvider) ?? "openai",
  }
}

function outOfCredits(provider: AiProvider): string {
  return provider === "openrouter"
    ? "Out of credits. Add credits at openrouter.ai/settings/credits."
    : "Out of credits. Add credits at platform.openai.com/settings/organization/billing."
}

async function validateOpenAiKey(
  key: string,
  model: string
): Promise<{ ok: boolean; error: string | null }> {
  // A tiny real request (a fraction of a cent). Retrieving the model alone
  // passes even when the account has no credits left.
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: "Reply with OK.", max_output_tokens: 16 }),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.ok) return { ok: true, error: null }
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; code?: string; type?: string }
  } | null
  const message = body?.error?.message ?? `OpenAI returned HTTP ${res.status}`
  if (
    body?.error?.type === "insufficient_quota" ||
    body?.error?.code === "insufficient_quota" ||
    isOutOfCredits(message)
  ) {
    return { ok: false, error: outOfCredits("openai") }
  }
  // A plain rate limit means the key itself works.
  if (res.status === 429) return { ok: true, error: null }
  if (res.status === 404) {
    return {
      ok: false,
      error: `Key works, but model "${model}" is not available to it: ${message}`,
    }
  }
  return { ok: false, error: message }
}

async function validateOpenRouterKey(
  key: string,
  model: string
): Promise<{ ok: boolean; error: string | null }> {
  // A one-token completion checks the key, the model and the credit balance.
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vividdit.com",
      "X-Title": "Vividdit",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.ok) return { ok: true, error: null }
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
  const message = body?.error?.message ?? `OpenRouter returned HTTP ${res.status}`
  if (res.status === 402 || isOutOfCredits(message)) {
    return { ok: false, error: outOfCredits("openrouter") }
  }
  if (res.status === 429) return { ok: true, error: null }
  if (res.status === 400 || res.status === 404) {
    return {
      ok: false,
      error: `Key works, but model "${model}" was not accepted: ${message}. Use a model id from openrouter.ai/models.`,
    }
  }
  return { ok: false, error: message }
}

/** Provider errors that mean the key itself needs fixing, not a retry. */
export function isOutOfCredits(message: string): boolean {
  return /insufficient_quota|no credits|credits remaining|exceeded your current quota|insufficient credits|billing/i.test(
    message
  )
}

export function isKeyProblem(message: string): boolean {
  return (
    isOutOfCredits(message) ||
    /invalid api key|incorrect api key|invalid_api_key|api key.*(revoked|disabled|not found)|unauthorized|no auth credentials|payment required|account.*deactivated/i.test(
      message
    )
  )
}

/**
 * Validates the stored key against its provider's API and persists the result.
 */
export async function testAiKey(creatorId: string): Promise<AiKeyInfo | null> {
  const admin = createAdminClient()
  const stored = await getDecryptedAiKey(creatorId)
  if (!stored) return null

  let keyStatus: "valid" | "invalid" | null = null
  let lastError: string | null = null

  try {
    const result =
      stored.provider === "openrouter"
        ? await validateOpenRouterKey(stored.key, stored.model)
        : await validateOpenAiKey(stored.key, stored.model)
    keyStatus = result.ok ? "valid" : "invalid"
    lastError = result.error
  } catch (err) {
    // The provider couldn't be reached: report it, but keep the last known
    // status rather than calling a working key broken.
    const name = stored.provider === "openrouter" ? "OpenRouter" : "OpenAI"
    lastError =
      err instanceof Error && err.name === "TimeoutError"
        ? `${name} API timed out`
        : `Could not reach the ${name} API`
  }

  await admin
    .from("creator_ai_keys")
    .update({
      ...(keyStatus ? { key_status: keyStatus } : {}),
      // A fixed key re-arms the "your key stopped working" email.
      ...(keyStatus === "valid" ? { alerted_at: null } : {}),
      last_tested_at: new Date().toISOString(),
      last_error: lastError,
    })
    // The tested key only: the creator may have replaced it meanwhile.
    .eq("id", stored.id)

  return getAiKeyInfo(creatorId)
}

/** Phase 4+ publish guard: SoundCloud (AI) gates need a valid key. */
export async function hasValidAiKey(creatorId: string): Promise<boolean> {
  const info = await getAiKeyInfo(creatorId)
  return info?.keyStatus === "valid"
}
