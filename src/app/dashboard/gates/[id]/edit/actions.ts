"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { hasValidAiKey } from "@/lib/ai-keys"
import { isHttpUrl, profileLabel } from "@/lib/profiles"
import { createClient } from "@/lib/supabase/server"

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1a1a1a")

const updateGateSchema = z.object({
  gateId: z.uuid(),
  accentColor: hex,
  backgroundColor: hex,
  coverPath: z.string().max(400).nullable().optional(),
  emailEnabled: z.boolean(),
  requireLike: z.boolean(),
  requireRepost: z.boolean(),
  requireProofCode: z.boolean(),
  followTargets: z.array(
    z.object({
      platform: z.enum(["soundcloud", "instagram", "spotify"]),
      url: z.string().trim().max(500),
    })
  ),
})

export type UpdateGateInput = z.input<typeof updateGateSchema>
export type UpdateGateResult = { ok: true } | { ok: false; error: string }

export async function updateGateAction(
  input: UpdateGateInput
): Promise<UpdateGateResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const parsed = updateGateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }
  const d = parsed.data

  // Ownership + current status (RLS also scopes, this is explicit).
  const { data: gate } = await supabase
    .from("gates")
    .select("id, status, theme")
    .eq("id", d.gateId)
    .eq("creator_id", user.id)
    .maybeSingle()
  if (!gate) return { ok: false, error: "Gate not found." }

  const trackActions = d.requireLike || d.requireRepost
  const targets = d.followTargets.filter((t) => isHttpUrl(t.url))
  const aiGate = trackActions || targets.length > 0

  if (!d.emailEnabled && !aiGate) {
    return { ok: false, error: "Enable at least one unlock requirement." }
  }
  if (d.followTargets.some((t) => !isHttpUrl(t.url))) {
    return { ok: false, error: "Every follow profile needs a valid URL." }
  }
  // A live (published) social gate needs a working verification key.
  if (gate.status === "published" && aiGate && !(await hasValidAiKey(user.id))) {
    return {
      ok: false,
      error:
        "Follow/social gates need a valid OpenAI key for proof verification. Add one in Settings, or switch to an email-only gate.",
    }
  }

  // Colors — preserve any other theme fields (e.g. artworkUrl).
  const theme = (gate.theme ?? {}) as Record<string, unknown>
  const update: Record<string, unknown> = {
    theme: {
      ...theme,
      accentColor: d.accentColor,
      backgroundColor: d.backgroundColor,
    },
  }
  // Only touch the cover when a freshly-uploaded path is provided, and only
  // within the creator's own storage namespace.
  if (d.coverPath) {
    if (!d.coverPath.startsWith(`${user.id}/`) || d.coverPath.includes("..")) {
      return { ok: false, error: "Invalid cover path." }
    }
    update.cover_path = d.coverPath
  }
  const { error: gateError } = await supabase
    .from("gates")
    .update(update)
    .eq("id", d.gateId)
    .eq("creator_id", user.id)
  if (gateError) return { ok: false, error: "Couldn't save the changes." }

  const hasSc = targets.some((t) => t.platform === "soundcloud")
  const { error: reqError } = await supabase
    .from("gate_requirements")
    .update({
      email_enabled: d.emailEnabled,
      soundcloud_enabled: trackActions || hasSc,
      require_like: d.requireLike,
      require_repost: d.requireRepost,
      require_follow: hasSc,
      require_proof_code: trackActions && d.requireProofCode,
      instagram_enabled: targets.some((t) => t.platform === "instagram"),
      spotify_enabled: targets.some((t) => t.platform === "spotify"),
    })
    .eq("gate_id", d.gateId)
  if (reqError) return { ok: false, error: "Couldn't save the requirements." }

  // Replace follow targets (FK on proof_images is ON DELETE SET NULL, so old
  // proofs are unaffected).
  await supabase.from("gate_follow_targets").delete().eq("gate_id", d.gateId)
  if (targets.length > 0) {
    const { error: targetError } = await supabase
      .from("gate_follow_targets")
      .insert(
        targets.map((t, i) => ({
          gate_id: d.gateId,
          platform: t.platform,
          profile_url: t.url,
          display_name: profileLabel(t.platform, t.url),
          sort_order: i,
        }))
      )
    if (targetError) {
      return { ok: false, error: "Couldn't save the follow profiles." }
    }
  }

  revalidatePath("/dashboard")
  return { ok: true }
}
