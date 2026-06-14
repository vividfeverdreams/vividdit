import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { UnlockPanel } from "@/app/[artistSlug]/[gateSlug]/unlock-panel"
import { soundcloudPlayerSrc } from "@/lib/soundcloud"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type Params = { artistSlug: string; gateSlug: string }
type SearchParams = { [key: string]: string | string[] | undefined }

async function loadGate(params: Params) {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, artist_name, artist_slug, soundcloud_profile_url")
    .eq("artist_slug", params.artistSlug)
    .maybeSingle()
  if (!profile) return null

  const { data: gate } = await supabase
    .from("gates")
    .select(
      "id, title, artist, soundcloud_url, instagram_url, spotify_url, slug, status, theme, cover_path"
    )
    .eq("creator_id", profile.id)
    .eq("slug", params.gateSlug)
    .eq("status", "published")
    .maybeSingle()
  if (!gate) return null

  const { data: requirements } = await supabase
    .from("gate_requirements")
    .select(
      "email_enabled, soundcloud_enabled, require_like, require_repost, require_follow, require_proof_code, instagram_enabled, spotify_enabled"
    )
    .eq("gate_id", gate.id)
    .maybeSingle()
  if (!requirements) return null

  return { profile, gate, requirements }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const data = await loadGate(await params)
  if (!data) return { title: "Gate not found" }
  return {
    title: `${data.gate.title} — free download`,
    description: `Download ${data.gate.title} by ${data.gate.artist} for free.`,
  }
}

function coverUrl(gate: {
  cover_path: string | null
  theme: { artworkUrl?: string | null } | null
}): string | null {
  if (gate.cover_path) {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/${gate.cover_path}`
  }
  return gate.theme?.artworkUrl ?? null
}

async function recordViewEvent(
  gateId: string,
  searchParams: SearchParams,
  referrer: string | null
) {
  const pick = (key: string): string | null => {
    const v = searchParams[key]
    return typeof v === "string" ? v.slice(0, 200) : null
  }
  const admin = createAdminClient()
  await admin.from("events").insert({
    gate_id: gateId,
    event_type: "view",
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    referrer: referrer?.slice(0, 500) ?? null,
    source: pick("source") ?? pick("ref"),
  })
}

export default async function GatePage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<SearchParams>
}) {
  const [p, sp] = await Promise.all([params, searchParams])
  const data = await loadGate(p)
  if (!data) notFound()

  const { profile, gate, requirements } = data
  const theme = (gate.theme ?? {}) as { accentColor?: string; artworkUrl?: string }
  const accent = theme.accentColor ?? "#18181b"
  const cover = coverUrl(gate)

  const headerList = await headers()
  await recordViewEvent(gate.id, sp, headerList.get("referer"))

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-4">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={`${gate.title} cover art`}
            className="size-20 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0">
          <p
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: accent }}
          >
            Free download
          </p>
          <h1 className="truncate text-xl font-semibold">{gate.title}</h1>
          <p className="truncate text-muted-foreground">{gate.artist}</p>
        </div>
      </header>

      <iframe
        title={`${gate.title} on SoundCloud`}
        width="100%"
        height="166"
        scrolling="no"
        frameBorder="no"
        allow="autoplay"
        src={soundcloudPlayerSrc(gate.soundcloud_url)}
      />

      <UnlockPanel
        gateId={gate.id}
        accent={accent}
        requirements={{
          emailEnabled: requirements.email_enabled,
          soundcloudEnabled: requirements.soundcloud_enabled,
          requireLike: requirements.require_like,
          requireRepost: requirements.require_repost,
          requireFollow: requirements.require_follow,
          requireProofCode: requirements.require_proof_code,
          instagramEnabled: requirements.instagram_enabled,
          instagramUrl: gate.instagram_url,
          spotifyEnabled: requirements.spotify_enabled,
          spotifyUrl: gate.spotify_url,
        }}
        track={{
          title: gate.title,
          artist: gate.artist,
          soundcloudUrl: gate.soundcloud_url,
          artistProfileUrl: profile.soundcloud_profile_url,
          artistName: profile.artist_name ?? gate.artist,
        }}
      />

      <footer className="mt-auto pt-8 text-center text-xs text-muted-foreground">
        Powered by Vividdit
      </footer>
    </main>
  )
}
