"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { hasValidAiKey } from "@/lib/ai-keys"
import { isHttpUrl, profileLabel } from "@/lib/profiles"
import { spotifyArtistName } from "@/lib/spotify"
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
  unlockMode: z.enum(["quick", "verified"]),
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
  const socialSteps = trackActions || targets.length > 0
  // Only Verified gates check screenshots, so only they need an AI key.
  const aiGate = socialSteps && d.unlockMode === "verified"

  if (!d.emailEnabled && !socialSteps) {
    return { ok: false, error: "Enable at least one unlock requirement." }
  }
  if (d.followTargets.some((t) => !isHttpUrl(t.url))) {
    return { ok: false, error: "Every follow profile needs a valid URL." }
  }
  // A live (published) Verified gate needs a working verification key.
  if (gate.status === "published" && aiGate && !(await hasValidAiKey(user.id))) {
    return {
      ok: false,
      error:
        "Verified gates need a working AI key to check screenshots. Add one in Settings, or switch to Quick unlock.",
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
      unlock_mode: d.unlockMode,
    })
    .eq("gate_id", d.gateId)
  if (reqError) return { ok: false, error: "Couldn't save the requirements." }

  // Keep the ids of follow targets that didn't change: fans' saved progress
  // and Verified screenshots are keyed by them. Only removed targets are
  // deleted (proof_images.follow_target_id is ON DELETE SET NULL) and only new
  // ones inserted.
  const { data: existing } = await supabase
    .from("gate_follow_targets")
    .select("id, platform, profile_url, display_name")
    .eq("gate_id", d.gateId)
  const unused = [...(existing ?? [])]
  const keep: { id: string; sort_order: number }[] = []
  const add: { platform: string; url: string; sort_order: number }[] = []
  targets.forEach((t, i) => {
    const match = unused.findIndex(
      (e) => e.platform === t.platform && e.profile_url === t.url
    )
    if (match === -1) {
      add.push({ platform: t.platform, url: t.url, sort_order: i })
    } else {
      keep.push({ id: unused[match].id, sort_order: i })
      unused.splice(match, 1)
    }
  })

  if (unused.length > 0) {
    await supabase
      .from("gate_follow_targets")
      .delete()
      .in(
        "id",
        unused.map((e) => e.id)
      )
  }
  for (const k of keep) {
    await supabase
      .from("gate_follow_targets")
      .update({ sort_order: k.sort_order })
      .eq("id", k.id)
  }
  if (add.length > 0) {
    const { error: targetError } = await supabase
      .from("gate_follow_targets")
      .insert(
        await Promise.all(
          add.map(async (t) => ({
            gate_id: d.gateId,
            platform: t.platform,
            profile_url: t.url,
            display_name:
              (t.platform === "spotify" && (await spotifyArtistName(t.url))) ||
              profileLabel(t.platform, t.url),
            sort_order: t.sort_order,
          }))
        )
      )
    if (targetError) {
      return { ok: false, error: "Couldn't save the follow profiles." }
    }
  }
  // Older Spotify targets were saved as "Spotify profile"; name them now.
  for (const e of existing ?? []) {
    if (
      e.platform === "spotify" &&
      keep.some((k) => k.id === e.id) &&
      (!e.display_name || e.display_name === "Spotify profile")
    ) {
      const name = await spotifyArtistName(e.profile_url)
      if (name) {
        await supabase
          .from("gate_follow_targets")
          .update({ display_name: name })
          .eq("id", e.id)
      }
    }
  }

  revalidatePath("/dashboard")
  return { ok: true }
}
