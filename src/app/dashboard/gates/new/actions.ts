"use server"

import { z } from "zod"

import { hasValidOpenAiKey } from "@/lib/ai-keys"
import { resolveSoundcloudTrack, type SoundcloudTrack } from "@/lib/soundcloud"
import { createClient } from "@/lib/supabase/server"
import { slugRegex } from "@/lib/validation"

export async function resolveTrackAction(
  url: string
): Promise<SoundcloudTrack | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in." }

  return resolveSoundcloudTrack(url)
}

export async function checkSlugAction(
  slug: string
): Promise<{ available: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { available: false }

  const { count } = await supabase
    .from("gates")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", user.id)
    .eq("slug", slug)

  return { available: (count ?? 0) === 0 }
}

const createGateSchema = z.object({
  soundcloudUrl: z.url(),
  title: z.string().trim().min(1, "Enter the track title").max(200),
  artist: z.string().trim().min(1, "Enter the artist name").max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(slugRegex, "Lowercase letters, numbers, and single hyphens only"),
  artworkUrl: z.url().nullable(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a valid color")
    .default("#18181b"),
  coverPath: z.string().nullable(),
  emailEnabled: z.boolean(),
  soundcloudEnabled: z.boolean(),
  requireLike: z.boolean(),
  requireRepost: z.boolean(),
  requireFollow: z.boolean(),
  asset: z
    .object({
      storagePath: z.string().min(1),
      filename: z.string().min(1),
      sizeBytes: z.number().int().positive(),
      mimeType: z.string().min(1),
    })
    .nullable(),
  publish: z.boolean(),
})

export type CreateGateInput = z.input<typeof createGateSchema>
export type CreateGateResult =
  | { ok: true; gateId: string; published: boolean }
  | { ok: false; error: string }

export async function createGateAction(
  input: CreateGateInput
): Promise<CreateGateResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const parsed = createGateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }
  const d = parsed.data

  if (!d.emailEnabled && !d.soundcloudEnabled) {
    return { ok: false, error: "Enable at least one unlock requirement." }
  }
  if (
    d.soundcloudEnabled &&
    !d.requireLike &&
    !d.requireRepost &&
    !d.requireFollow
  ) {
    return {
      ok: false,
      error: "Pick at least one SoundCloud action (like, repost, or follow).",
    }
  }

  if (d.publish) {
    if (!d.asset) {
      return { ok: false, error: "Upload the HQ file before publishing." }
    }
    if (d.soundcloudEnabled && !(await hasValidOpenAiKey(user.id))) {
      return {
        ok: false,
        error:
          "SoundCloud gates need a valid OpenAI key for proof verification. Add one in Settings, or switch to an email-only gate.",
      }
    }
  }

  const { data: gate, error: gateError } = await supabase
    .from("gates")
    .insert({
      creator_id: user.id,
      title: d.title,
      artist: d.artist,
      soundcloud_url: d.soundcloudUrl,
      slug: d.slug,
      status: d.publish ? "published" : "draft",
      cover_path: d.coverPath,
      theme: { accentColor: d.accentColor, artworkUrl: d.artworkUrl },
    })
    .select("id")
    .single()

  if (gateError || !gate) {
    if (gateError?.code === "23505") {
      return { ok: false, error: "You already use that slug — pick another." }
    }
    return { ok: false, error: "Couldn't create the gate. Try again." }
  }

  const { error: reqError } = await supabase.from("gate_requirements").insert({
    gate_id: gate.id,
    email_enabled: d.emailEnabled,
    soundcloud_enabled: d.soundcloudEnabled,
    require_like: d.soundcloudEnabled && d.requireLike,
    require_repost: d.soundcloudEnabled && d.requireRepost,
    require_follow: d.soundcloudEnabled && d.requireFollow,
  })

  if (reqError) {
    await supabase.from("gates").delete().eq("id", gate.id)
    return { ok: false, error: "Couldn't save unlock requirements. Try again." }
  }

  if (d.asset) {
    const { error: assetError } = await supabase.from("download_assets").insert({
      gate_id: gate.id,
      storage_path: d.asset.storagePath,
      filename: d.asset.filename,
      size_bytes: d.asset.sizeBytes,
      mime_type: d.asset.mimeType,
    })
    if (assetError) {
      await supabase.from("gates").delete().eq("id", gate.id)
      return { ok: false, error: "Couldn't attach the HQ file. Try again." }
    }
  }

  return { ok: true, gateId: gate.id, published: d.publish }
}
