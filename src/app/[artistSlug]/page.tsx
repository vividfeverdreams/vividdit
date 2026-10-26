import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  InstagramIcon,
  SoundCloudIcon,
  SpotifyIcon,
} from "@/components/brand-icons"
import { gateTheme } from "@/lib/colors"
import { createClient } from "@/lib/supabase/server"

// The artist's link-in-bio page: every free download in one place, the vault
// first. Only published gates are visible to the public (RLS).

type Params = { artistSlug: string }

type GateCard = {
  slug: string
  title: string
  kind: string
  cover: string | null
  accent: string | null
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

async function loadArtist(artistSlug: string) {
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, artist_name, artist_slug, soundcloud_profile_url, instagram_url, spotify_url")
    .eq("artist_slug", artistSlug)
    .maybeSingle()
  if (!profile) return null

  const { data: gates } = await supabase
    .from("gates")
    .select("slug, title, kind, in_vault, cover_path, theme, published_at")
    .eq("creator_id", profile.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
  if (!gates?.length) return null

  const cards: GateCard[] = gates.map((g) => {
    const theme = (g.theme ?? {}) as { artworkUrl?: string | null; accentColor?: string }
    return {
      slug: g.slug,
      title: g.title,
      kind: g.kind,
      cover: coverUrl({ cover_path: g.cover_path, theme }),
      accent: theme.accentColor ?? null,
    }
  })
  const vault = cards.find((c) => c.kind === "vault") ?? null
  const singles = cards.filter((c) => c.kind === "single")
  const vaultCount = gates.filter((g) => g.kind === "single" && g.in_vault).length
  return { profile, vault, singles, vaultCount }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const data = await loadArtist((await params).artistSlug)
  if (!data) return { title: "Artist not found" }
  const name = data.profile.artist_name ?? data.profile.artist_slug
  const image = data.vault?.cover ?? data.singles[0]?.cover
  return {
    title: `${name} — free downloads`,
    description: `Every free download from ${name}.`,
    openGraph: {
      title: `${name} — free downloads`,
      description: `Every free download from ${name}.`,
      ...(image ? { images: [{ url: image }] } : {}),
    },
  }
}

export default async function ArtistPage({ params }: { params: Promise<Params> }) {
  const { artistSlug } = await params
  const data = await loadArtist(artistSlug)
  if (!data) notFound()

  const { profile, vault, singles, vaultCount } = data
  const name = profile.artist_name ?? profile.artist_slug
  const theme = gateTheme(vault?.accent ?? "#ffffff", "#0b0b0c")
  const vaultCovers = singles.filter((s) => s.cover).slice(0, 9)

  const links = [
    { url: profile.soundcloud_profile_url, label: "SoundCloud", Icon: SoundCloudIcon },
    { url: profile.instagram_url, label: "Instagram", Icon: InstagramIcon },
    { url: profile.spotify_url, label: "Spotify", Icon: SpotifyIcon },
  ].filter((l): l is { url: string; label: string; Icon: typeof SoundCloudIcon } => !!l.url)

  return (
    <main
      className="flex min-h-svh flex-col items-center px-4 py-8 md:py-14"
      style={{ backgroundColor: theme.bg, color: theme.fg }}
    >
      <div className="w-full max-w-3xl space-y-8">
        <header className="space-y-3 text-center">
          <p
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: theme.muted }}
          >
            Free downloads
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
            {name}
          </h1>
          {links.length > 0 && (
            <div className="flex justify-center gap-2">
              {links.map(({ url, label, Icon }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${name} on ${label}`}
                  className="grid size-11 place-items-center rounded-full border transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                  style={{ borderColor: theme.line }}
                >
                  <Icon className="size-5" />
                </a>
              ))}
            </div>
          )}
        </header>

        {vault && vaultCount > 1 && (
          <a
            href={`/${profile.artist_slug}/${vault.slug}`}
            className="group flex flex-col gap-4 rounded-2xl border p-4 transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:flex-row sm:items-center"
            style={{ backgroundColor: theme.card, borderColor: theme.line }}
          >
            {vault.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={vault.cover}
                alt=""
                className="aspect-square w-full rounded-xl object-cover sm:w-36"
              />
            ) : (
              <div className="grid w-full grid-cols-3 gap-1 sm:w-36">
                {vaultCovers.map((s) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={s.slug}
                    src={s.cover!}
                    alt=""
                    className="aspect-square w-full rounded object-cover"
                  />
                ))}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xl font-bold tracking-tight">{vault.title}</p>
              <p className="text-sm" style={{ color: theme.muted }}>
                {vaultCount} tracks. Unlock once, get them all.
              </p>
            </div>
            <span
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold"
              style={{ backgroundColor: theme.accent, color: theme.accentFg }}
            >
              Unlock all {vaultCount}
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
          </a>
        )}

        <section aria-label="Releases">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {singles.map((gate) => (
              <li key={gate.slug}>
                <a
                  href={`/${profile.artist_slug}/${gate.slug}`}
                  className="group block rounded-xl p-1.5 transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  {gate.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={gate.cover}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div
                      className="aspect-square w-full rounded-lg"
                      style={{ backgroundColor: theme.subtle }}
                    />
                  )}
                  <p className="mt-2 line-clamp-2 text-sm leading-snug font-semibold">
                    {gate.title}
                  </p>
                  <p className="mt-0.5 text-[13px]" style={{ color: theme.muted }}>
                    Free download
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="mt-12 text-[13px]" style={{ color: theme.muted }}>
        <Link href="/" className="px-2 py-1 underline-offset-2 hover:underline">
          Powered by Vividdit
        </Link>
      </footer>
    </main>
  )
}
