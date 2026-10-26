import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { TrackingPixels } from "@/app/[artistSlug]/[gateSlug]/tracking-pixels"
import {
  UnlockPanel,
  type DownloadFile,
  type VaultOffer,
} from "@/app/[artistSlug]/[gateSlug]/unlock-panel"
import { gateTheme, readableAccent } from "@/lib/colors"
import { soundcloudPlayerSrc } from "@/lib/soundcloud"
import { spotifyArtistName } from "@/lib/spotify"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { VAULT_RESCUE_USER_AGENT } from "@/lib/vault-rescue-constants"

type Params = { artistSlug: string; gateSlug: string }

// Social proof only shows once a gate has real traction.
const SHOW_UNLOCKS_FROM = 25

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
      "id, title, artist, soundcloud_url, instagram_url, spotify_url, slug, status, theme, cover_path, tracking, kind"
    )
    .eq("creator_id", profile.id)
    .eq("slug", params.gateSlug)
    .eq("status", "published")
    .maybeSingle()
  if (!gate) return null

  const { data: requirements } = await supabase
    .from("gate_requirements")
    .select(
      "email_enabled, require_like, require_repost, require_proof_code, unlock_mode"
    )
    .eq("gate_id", gate.id)
    .maybeSingle()
  if (!requirements) return null

  const { data: followTargets } = await supabase
    .from("gate_follow_targets")
    .select("id, platform, profile_url, display_name, sort_order")
    .eq("gate_id", gate.id)
    .order("sort_order", { ascending: true })

  // Vault: every published, included track. A published single gate always has
  // a download file (the publish guard requires one), so this count is exactly
  // what a fan unlocks. Covers are only for the hero grid (capped for layout).
  let vaultCovers: string[] = []
  let vaultTitles: string[] = []
  let vaultTrackCount = 0
  if (gate.kind === "vault") {
    const { data: tracks } = await supabase
      .from("gates")
      .select("title, cover_path, theme")
      .eq("creator_id", profile.id)
      .eq("kind", "single")
      .eq("in_vault", true)
      .eq("status", "published")
      .order("created_at", { ascending: false })
    vaultTrackCount = (tracks ?? []).length
    vaultTitles = (tracks ?? []).map((t) => t.title)
    vaultCovers = (tracks ?? [])
      .map((t) =>
        coverUrl({
          cover_path: t.cover_path,
          theme: t.theme as { artworkUrl?: string | null } | null,
        })
      )
      .filter((u): u is string => !!u)
      .slice(0, 12)
  }

  return {
    profile,
    gate,
    requirements,
    followTargets: followTargets ?? [],
    vaultCovers,
    vaultTitles,
    vaultTrackCount,
  }
}

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** What the fan gets, the vault offer and the unlock count. Service role:
 *  download files and submissions aren't readable by anonymous visitors. */
async function loadExtras(gate: { id: string; kind: string }, creatorId: string, artistSlug: string) {
  const admin = createAdminClient()
  const [{ data: asset }, { data: vault }, { count: unlocks }] = await Promise.all([
    gate.kind === "single"
      ? admin
          .from("download_assets")
          .select("filename, size_bytes")
          .eq("gate_id", gate.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    gate.kind === "single"
      ? admin
          .from("gates")
          .select("slug")
          .eq("creator_id", creatorId)
          .eq("kind", "vault")
          .eq("status", "published")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("gate_id", gate.id)
      .not("unlocked_at", "is", null)
      .neq("status", "rejected")
      .neq("user_agent", VAULT_RESCUE_USER_AGENT),
  ])

  let file: DownloadFile | null = null
  if (asset) {
    const ext = asset.filename.split(".").pop()?.toUpperCase()
    file = {
      format: ext && ext.length <= 5 ? ext : "file",
      name: asset.filename,
      size: formatBytes(asset.size_bytes),
    }
  }

  let vaultOffer: VaultOffer | null = null
  if (vault) {
    const { count } = await admin
      .from("gates")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", creatorId)
      .eq("kind", "single")
      .eq("in_vault", true)
      .eq("status", "published")
    if ((count ?? 0) > 1) {
      vaultOffer = { url: `/${artistSlug}/${vault.slug}`, count: count ?? 0 }
    }
  }

  return { file, vaultOffer, unlocks: unlocks ?? 0 }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const data = await loadGate(await params)
  if (!data) return { title: "Gate not found" }
  const cover = coverUrl(data.gate)
  return {
    title: `${data.gate.title} — free download`,
    description: `Download ${data.gate.title} by ${data.gate.artist} for free.`,
    openGraph: {
      title: `${data.gate.title} — free download`,
      description: `Free download from ${data.gate.artist}.`,
      ...(cover ? { images: [{ url: cover }] } : {}),
    },
  }
}

// A short, one-line label for a follow target when the creator didn't set a
// display name. Instagram/SoundCloud handles are the first path segment; other
// URLs are just stripped of their scheme/www.
function followHandle(platform: string, url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split("/").filter(Boolean)
    if ((platform === "instagram" || platform === "soundcloud") && seg[0]) {
      return `@${seg[0]}`
    }
    return (u.host.replace(/^www\./, "") + u.pathname).replace(/\/$/, "")
  } catch {
    return url
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

export default async function GatePage({
  params,
}: {
  params: Promise<Params>
}) {
  const p = await params
  const data = await loadGate(p)
  if (!data) notFound()

  const {
    profile,
    gate,
    requirements,
    followTargets,
    vaultCovers,
    vaultTitles,
    vaultTrackCount,
  } = data
  const isVault = gate.kind === "vault"
  const themeColors = (gate.theme ?? {}) as {
    accentColor?: string
    backgroundColor?: string
    artworkUrl?: string
  }
  const theme = gateTheme(
    themeColors.accentColor ?? "#18181b",
    themeColors.backgroundColor ?? "#0a0a0a"
  )
  // Guarantee the accent-colored label stays legible on the background.
  const labelColor = readableAccent(themeColors.accentColor ?? theme.fg, theme.bg)
  const cover = coverUrl(gate)
  const tracking = {
    facebookPixelId: null,
    googleAdsTagId: null,
    googleConversionLabel: null,
    tiktokPixelId: null,
    ...((gate.tracking ?? {}) as Record<string, string | null>),
  }

  const [{ file, vaultOffer, unlocks }, targets] = await Promise.all([
    loadExtras(gate, profile.id, profile.artist_slug ?? p.artistSlug),
    Promise.all(
      followTargets.map(async (t) => {
        let displayName = t.display_name
        if (t.platform === "spotify" && (!displayName || displayName === "Spotify profile")) {
          displayName = await spotifyArtistName(t.profile_url)
        }
        return {
          id: t.id,
          platform: t.platform as "soundcloud" | "instagram" | "spotify",
          profileUrl: t.profile_url,
          displayName:
            displayName ??
            (t.platform === "spotify" ? "the artist" : followHandle(t.platform, t.profile_url)),
        }
      })
    ),
  ])

  const label = isVault
    ? "Free download"
    : `Free download${file ? ` · ${file.format}` : ""}`

  return (
    <main
      className="flex min-h-svh flex-col items-center px-4 py-5 md:justify-center md:py-10"
      style={{ backgroundColor: theme.bg, color: theme.fg }}
    >
      <div className="flex w-full max-w-md flex-col gap-4 md:max-w-3xl md:flex-row md:items-start md:gap-8">
        {/* Media — cover, title, player (single) or vault hero */}
        <div className="flex flex-col gap-3 md:sticky md:top-10 md:w-[320px] md:shrink-0">
          {isVault && !cover && vaultCovers.length > 0 ? (
            <div className="mx-auto grid w-44 grid-cols-3 gap-1 md:w-full">
              {vaultCovers.slice(0, 9).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="aspect-square w-full rounded-md object-cover shadow"
                />
              ))}
            </div>
          ) : (
            cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt={`${gate.title} cover art`}
                className="mx-auto aspect-square w-28 rounded-xl object-cover shadow-lg md:w-full"
              />
            )
          )}

          <div className="text-center">
            <p
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: labelColor }}
            >
              {label}
            </p>
            <h1 className="mt-0.5 text-xl leading-tight font-bold text-balance md:text-2xl">
              {gate.title}
            </h1>
            <p className="text-sm" style={{ color: theme.muted }}>
              {isVault
                ? `${vaultTrackCount} track${vaultTrackCount === 1 ? "" : "s"} · unlock once, get them all`
                : gate.artist}
            </p>
            {unlocks >= SHOW_UNLOCKS_FROM && (
              <p className="mt-1 text-[13px]" style={{ color: theme.muted }}>
                {unlocks.toLocaleString("en-US")} fans unlocked this
              </p>
            )}
          </div>

          {!isVault && (
            <iframe
              title={`${gate.title} on SoundCloud`}
              width="100%"
              height="120"
              scrolling="no"
              frameBorder="no"
              allow="autoplay"
              loading="lazy"
              className="rounded-lg"
              src={soundcloudPlayerSrc(gate.soundcloud_url)}
            />
          )}
        </div>

        {/* Unlock card — sits beside the media on desktop */}
        <div className="flex flex-col gap-3 md:min-w-0 md:flex-1">
          <UnlockPanel
            gateId={gate.id}
            theme={theme}
            unlockMode={requirements.unlock_mode === "verified" ? "verified" : "quick"}
            requirements={{
              emailEnabled: requirements.email_enabled,
              requireLike: requirements.require_like,
              requireRepost: requirements.require_repost,
              requireProofCode: requirements.require_proof_code,
              followTargets: targets,
            }}
            track={{
              title: gate.title,
              artist: gate.artist,
              soundcloudUrl: gate.soundcloud_url,
              artistName: profile.artist_name ?? gate.artist,
            }}
            tracking={tracking}
            isVault={isVault}
            file={file}
            vaultOffer={vaultOffer}
          />

          {isVault && vaultTitles.length > 0 && (
            <details
              className="rounded-2xl border px-4 text-sm"
              style={{ borderColor: theme.line, color: theme.muted }}
            >
              <summary
                className="flex min-h-12 cursor-pointer items-center font-medium"
                style={{ color: theme.fg }}
              >
                What&apos;s in the vault ({vaultTitles.length})
              </summary>
              <ol className="list-decimal space-y-1 pb-4 pl-5">
                {vaultTitles.map((title, i) => (
                  <li key={i}>{title}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>

      <footer
        className="mt-8 flex flex-col items-center gap-1 text-center text-[13px]"
        style={{ color: theme.muted }}
      >
        <Link href="/" className="px-2 py-1 underline-offset-2 hover:underline">
          Powered by Vividdit
        </Link>
        <span className="flex gap-3">
          <Link href="/privacy" className="px-2 py-1 underline-offset-2 hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="px-2 py-1 underline-offset-2 hover:underline">
            Terms
          </Link>
        </span>
      </footer>

      <TrackingPixels tracking={tracking} accent={theme.accent} />
    </main>
  )
}
