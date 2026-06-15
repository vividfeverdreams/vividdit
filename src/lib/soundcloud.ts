import "server-only"

export type SoundcloudTrack = {
  canonicalUrl: string
  title: string
  artist: string
  artworkUrl: string | null
  authorUrl: string | null
}

const ALLOWED_HOSTS = new Set([
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
  "on.soundcloud.com",
])

export function isSoundcloudUrl(raw: string): boolean {
  try {
    return ALLOWED_HOSTS.has(new URL(raw).hostname)
  } catch {
    return false
  }
}

/**
 * Resolves any SoundCloud track link (including on.soundcloud.com short
 * links) to its canonical URL and public metadata via oEmbed.
 */
export async function resolveSoundcloudTrack(
  raw: string
): Promise<SoundcloudTrack | { error: string }> {
  if (!isSoundcloudUrl(raw)) {
    return { error: "Enter a soundcloud.com track URL." }
  }

  // Follow short-link/share redirects to the real track page.
  let finalUrl: URL
  try {
    const res = await fetch(raw, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    })
    finalUrl = new URL(res.url)
  } catch {
    return { error: "Couldn't reach SoundCloud. Check the link and try again." }
  }

  if (!ALLOWED_HOSTS.has(finalUrl.hostname)) {
    return { error: "That link doesn't lead to a SoundCloud track." }
  }

  // Strip share/query junk (?in=set&si=…&utm_…) for a stable canonical URL.
  const canonicalUrl = `https://soundcloud.com${finalUrl.pathname}`

  let oembed: {
    title?: string
    author_name?: string
    author_url?: string
    thumbnail_url?: string
  }
  try {
    const res = await fetch(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) {
      return {
        error:
          "SoundCloud couldn't find that track. Make sure it's public and the link points to a single track.",
      }
    }
    oembed = await res.json()
  } catch {
    return { error: "Couldn't fetch track info from SoundCloud." }
  }

  const author = oembed.author_name ?? ""
  let title = oembed.title ?? ""
  // oEmbed titles read "Track Title by author" — strip the suffix.
  if (author && title.endsWith(` by ${author}`)) {
    title = title.slice(0, -` by ${author}`.length)
  }

  return {
    canonicalUrl,
    title,
    artist: author,
    artworkUrl: oembed.thumbnail_url ?? null,
    authorUrl: oembed.author_url ?? null,
  }
}

/** Player embed URL for the official SoundCloud widget iframe. */
export function soundcloudPlayerSrc(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    // Compact player — the gate page features the cover art separately.
    visual: "false",
    show_artwork: "false",
  })
  return `https://w.soundcloud.com/player/?${params.toString()}`
}
