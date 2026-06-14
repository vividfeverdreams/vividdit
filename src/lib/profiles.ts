// Client-safe helpers for follow-target profile URLs.

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/** Human label for a profile URL, e.g. "@vividfeverdreams" or "Spotify profile". */
export function profileLabel(platform: string, url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split("/").filter(Boolean)
    const last = seg[seg.length - 1] ?? ""
    if (platform === "spotify") {
      // Spotify artist URLs end in an opaque ID — not human-friendly.
      return last && !/^[0-9A-Za-z]{20,}$/.test(last) ? last : "Spotify profile"
    }
    return last ? `@${last}` : url
  } catch {
    return url
  }
}
