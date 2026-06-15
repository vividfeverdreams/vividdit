// Client-safe AI provider/model constants (NO server-only deps). Shared by the
// server key module (ai-keys.ts) and the settings UI client component.

export type AiProvider = "openai" | "openrouter"

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
}

// OpenAI verification models (fixed list — these are the platform-blessed ones).
export const VERIFICATION_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4",
  "gpt-5.5",
] as const
export type VerificationModel = (typeof VERIFICATION_MODELS)[number]
export const DEFAULT_VERIFICATION_MODEL: VerificationModel = "gpt-5.4-mini"

// OpenRouter exposes hundreds of models; the model field is free-text so any
// OpenRouter model id works. These are vision- + structured-output-capable
// suggestions shown in the UI. Verification relies on JSON-schema structured
// output, which OpenAI and Google models on OpenRouter support reliably.
export const OPENROUTER_SUGGESTED_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "google/gemini-2.5-flash",
] as const
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini"

/** OpenRouter keys are `sk-or-…`; OpenAI keys are `sk-…` / `sk-proj-…`. */
export function providerFromKey(rawKey: string): AiProvider {
  return rawKey.trim().startsWith("sk-or-") ? "openrouter" : "openai"
}

/** Loose validation for a free-text OpenRouter model id (vendor/model). */
export function isValidOpenRouterModel(model: string): boolean {
  return model.length <= 100 && /^[\w.-]+\/[\w.:-]+$/.test(model.trim())
}
