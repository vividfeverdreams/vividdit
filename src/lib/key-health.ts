import "server-only"

import { testAiKey } from "@/lib/ai-keys"
import { sendKeyAlertEmail } from "@/lib/email"
import { testResendKey } from "@/lib/email-keys"
import { createAdminClient } from "@/lib/supabase/admin"

// Key health: a creator's AI key that runs out of credits used to fail
// silently for weeks. Real verification failures mark the key broken at once,
// a nightly check re-tests every key a live gate depends on, and the creator
// gets one email per breakage (re-armed when the key passes again).

type Admin = ReturnType<typeof createAdminClient>

const PROVIDER_NAME: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
}

/** Creators with at least one published gate that checks screenshots. */
export async function creatorsWithVerifiedGates(admin: Admin): Promise<string[]> {
  const { data } = await admin
    .from("gates")
    .select("creator_id, gate_requirements!inner(unlock_mode)")
    .eq("status", "published")
    .eq("gate_requirements.unlock_mode", "verified")
  return [...new Set((data ?? []).map((g) => g.creator_id as string))]
}

export async function alertAiKeyOnce(
  admin: Admin,
  creatorId: string,
  provider: string,
  error: string,
  keyId?: string
): Promise<void> {
  let claim = admin
    .from("creator_ai_keys")
    .update({ alerted_at: new Date().toISOString() })
    .eq("creator_id", creatorId)
    .eq("key_status", "invalid")
    .is("alerted_at", null)
  if (keyId) claim = claim.eq("id", keyId)
  const { data: claimed } = await claim.select("id").maybeSingle()
  if (!claimed) return

  let sent = false
  try {
    sent = await sendKeyAlertEmail({
      creatorId,
      provider: PROVIDER_NAME[provider] ?? provider,
      error,
    })
  } catch (err) {
    console.error("[key-health] alert email failed:", err)
  }
  if (!sent) {
    await admin
      .from("creator_ai_keys")
      .update({ alerted_at: null })
      .eq("id", claimed.id)
  }
}

/**
 * A real verification failed because of the key: record it and tell the
 * creator. Scoped to the key that was used, so a late failure can't mark a
 * replacement key broken.
 */
export async function markAiKeyBroken(
  admin: Admin,
  creatorId: string,
  keyId: string,
  provider: string,
  error: string
): Promise<void> {
  const { data: marked } = await admin
    .from("creator_ai_keys")
    .update({
      key_status: "invalid",
      last_error: error.slice(0, 500),
      last_tested_at: new Date().toISOString(),
    })
    .eq("id", keyId)
    .select("id")
    .maybeSingle()
  if (marked) await alertAiKeyOnce(admin, creatorId, provider, error, keyId)
}

/** Nightly: re-test the AI keys behind Verified gates and every Resend key. */
export async function checkCreatorKeys(admin: Admin): Promise<{
  aiTested: number
  aiBroken: number
  emailTested: number
  emailBroken: number
}> {
  let aiTested = 0
  let aiBroken = 0
  for (const creatorId of await creatorsWithVerifiedGates(admin)) {
    const info = await testAiKey(creatorId)
    if (!info) continue
    aiTested++
    if (info.keyStatus === "invalid") {
      aiBroken++
      await alertAiKeyOnce(
        admin,
        creatorId,
        info.provider,
        info.lastError ?? "The key failed its check."
      )
    }
  }

  let emailTested = 0
  let emailBroken = 0
  const { data: emailKeys } = await admin
    .from("creator_email_keys")
    .select("creator_id")
  for (const row of emailKeys ?? []) {
    const info = await testResendKey(row.creator_id)
    if (!info) continue
    emailTested++
    if (info.keyStatus === "invalid") emailBroken++
  }

  return { aiTested, aiBroken, emailTested, emailBroken }
}
