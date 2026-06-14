"use server"

import { randomUUID } from "node:crypto"
import { z } from "zod"

import { hasValidOpenAiKey } from "@/lib/ai-keys"
import { FREE_GATE_LIMIT } from "@/lib/limits"
import { resolveSoundcloudTrack, type SoundcloudTrack } from "@/lib/soundcloud"
import { hasValidR2, presignR2Upload } from "@/lib/storage"
import { createClient } from "@/lib/supabase/server"
import { slugRegex } from "@/lib/validation"

export type HqUploadTarget =
  | { provider: "r2"; uploadUrl: string; objectKey: string }
  | { provider: "supabase" }

// The wizard asks where to upload before sending the file: a creator's own R2
// (presigned PUT, direct browser → R2) or our Supabase bucket (TUS).
export async function getHqUploadTargetAction(
  filename: string,
  contentType: string
): Promise<HqUploadTarget | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in." }

  if (await hasValidR2(user.id)) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const objectKey = `${user.id}/${randomUUID()}/${safe}`
    const uploadUrl = await presignR2Upload(user.id, objectKey, contentType)
    if (uploadUrl) return { provider: "r2", uploadUrl, objectKey }
  }
  return { provider: "supabase" }
}

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
  requireProofCode: z.boolean().default(true),
  instagramEnabled: z.boolean().default(false),
  instagramUrl: z.string().nullable().default(null),
  spotifyEnabled: z.boolean().default(false),
  spotifyUrl: z.string().nullable().default(null),
  asset: z
    .object({
      storagePath: z.string().min(1),
      filename: z.string().min(1),
      sizeBytes: z.number().int().positive(),
      mimeType: z.string().min(1),
      storageProvider: z.enum(["supabase", "r2"]).default("supabase"),
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

  // Free creators get FREE_GATE_LIMIT gates on our storage; connecting R2
  // lifts the cap. Archived gates don't count toward the limit.
  const byor2 = await hasValidR2(user.id)
  if (!byor2) {
    const { count } = await supabase
      .from("gates")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id)
      .neq("status", "archived")
    if ((count ?? 0) >= FREE_GATE_LIMIT) {
      return {
        ok: false,
        error: `Free accounts can have ${FREE_GATE_LIMIT} active gates. Connect your own Cloudflare R2 storage in Settings for unlimited gates.`,
      }
    }
  }

  const aiGate = d.soundcloudEnabled || d.instagramEnabled || d.spotifyEnabled

  if (!d.emailEnabled && !aiGate) {
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
  const isUrl = (v: string | null) => {
    if (!v) return false
    try {
      new URL(v)
      return true
    } catch {
      return false
    }
  }
  if (d.instagramEnabled && !isUrl(d.instagramUrl)) {
    return { ok: false, error: "Add the Instagram profile URL to follow." }
  }
  if (d.spotifyEnabled && !isUrl(d.spotifyUrl)) {
    return { ok: false, error: "Add the Spotify profile URL to follow." }
  }

  if (d.publish) {
    if (!d.asset) {
      return { ok: false, error: "Upload the HQ file before publishing." }
    }
    if (aiGate && !(await hasValidOpenAiKey(user.id))) {
      return {
        ok: false,
        error:
          "Follow/social gates need a valid OpenAI key for proof verification. Add one in Settings, or switch to an email-only gate.",
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
      instagram_url: d.instagramEnabled ? d.instagramUrl : null,
      spotify_url: d.spotifyEnabled ? d.spotifyUrl : null,
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
    require_proof_code: d.soundcloudEnabled && d.requireProofCode,
    instagram_enabled: d.instagramEnabled,
    spotify_enabled: d.spotifyEnabled,
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
      storage_provider: d.asset.storageProvider,
    })
    if (assetError) {
      await supabase.from("gates").delete().eq("id", gate.id)
      return { ok: false, error: "Couldn't attach the HQ file. Try again." }
    }
  }

  return { ok: true, gateId: gate.id, published: d.publish }
}
