import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { TrackingPixels } from "@/app/[artistSlug]/[gateSlug]/tracking-pixels"
import { UnlockPanel } from "@/app/[artistSlug]/[gateSlug]/unlock-panel"
import { muted, readableAccent, readableForeground } from "@/lib/colors"
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
      "id, title, artist, soundcloud_url, instagram_url, spotify_url, slug, status, theme, cover_path, tracking"
    )
    .eq("creator_id", profile.id)
    .eq("slug", params.gateSlug)
    .eq("status", "published")
    .maybeSingle()
  if (!gate) return null

  const { data: requirements } = await supabase
    .from("gate_requirements")
    .select("email_enabled, require_like, require_repost, require_proof_code")
    .eq("gate_id", gate.id)
    .maybeSingle()
  if (!requirements) return null

  const { data: followTargets } = await supabase
    .from("gate_follow_targets")
    .select("id, platform, profile_url, display_name, sort_order")
    .eq("gate_id", gate.id)
    .order("sort_order", { ascending: true })

  return { profile, gate, requirements, followTargets: followTargets ?? [] }
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

  const { profile, gate, requirements, followTargets } = data
  const theme = (gate.theme ?? {}) as {
    accentColor?: string
    backgroundColor?: string
    artworkUrl?: string
  }
  const accent = theme.accentColor ?? "#18181b"
  const background = theme.backgroundColor ?? "#0a0a0a"
  const fg = readableForeground(background)
  // Guarantee the accent-colored label stays legible on the background.
  const labelColor = readableAccent(accent, background)
  const cover = coverUrl(gate)
  const tracking = {
    facebookPixelId: null,
    googleAdsTagId: null,
    googleConversionLabel: null,
    tiktokPixelId: null,
    ...((gate.tracking ?? {}) as Record<string, string | null>),
  }

  const headerList = await headers()
  await recordViewEvent(gate.id, sp, headerList.get("referer"))

  return (
    <main
      className="flex min-h-svh flex-col items-center px-4 py-10"
      style={{ backgroundColor: background, color: fg }}
    >
      <div className="flex w-full max-w-md flex-1 flex-col gap-6">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={`${gate.title} cover art`}
            className="aspect-square w-full rounded-2xl object-cover shadow-2xl"
          />
        )}
        <div className="text-center">
          <p
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: labelColor }}
          >
            Free download
          </p>
          <h1 className="text-2xl font-bold">{gate.title}</h1>
          <p style={{ color: muted(fg, 0.7) }}>{gate.artist}</p>
        </div>

        <iframe
          title={`${gate.title} on SoundCloud`}
          width="100%"
          height="120"
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
          requireLike: requirements.require_like,
          requireRepost: requirements.require_repost,
          requireProofCode: requirements.require_proof_code,
          followTargets: followTargets.map((t) => ({
            id: t.id,
            platform: t.platform as "soundcloud" | "instagram" | "spotify",
            profileUrl: t.profile_url,
            displayName: t.display_name ?? t.profile_url,
          })),
        }}
        track={{
          title: gate.title,
          artist: gate.artist,
          soundcloudUrl: gate.soundcloud_url,
          artistName: profile.artist_name ?? gate.artist,
        }}
        tracking={tracking}
        />

        <footer
          className="mt-auto flex flex-col items-center gap-1 pt-8 text-center text-xs"
          style={{ color: muted(fg, 0.5) }}
        >
          <span>Powered by Vividdit</span>
          <span className="flex gap-3">
            <a href="/privacy" className="underline-offset-2 hover:underline">
              Privacy
            </a>
            <a href="/terms" className="underline-offset-2 hover:underline">
              Terms
            </a>
          </span>
        </footer>
      </div>

      <TrackingPixels tracking={tracking} accent={accent} />
    </main>
  )
}
