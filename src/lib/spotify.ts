import "server-only"

// Spotify artist URLs end in an opaque id, so a follow step would read
// "Follow Spotify profile". oEmbed gives the artist's real name without an API
// key; the result is cached for a day.
export async function spotifyArtistName(url: string): Promise<string | null> {
  try {
    const u = new URL(url)
    if (u.hostname !== "open.spotify.com") return null
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const body = (await res.json()) as { title?: string }
    const title = body.title?.trim()
    return title ? title.slice(0, 100) : null
  } catch {
    return null
  }
}
