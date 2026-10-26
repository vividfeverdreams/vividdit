// Links that open a profile or track in the fan's installed app. On iPhone a
// plain https link to instagram.com, soundcloud.com or open.spotify.com is a
// universal link, so the app opens on tap; it stays in the same tab, so a fan
// without the app lands on the web page and Back returns them to the gate.
// Android needs an intent:// URL to skip the browser, with the web page as the
// fallback. Inside Instagram's own in-app browser an instagram:// link opens
// the profile natively. Desktop opens a new tab and keeps the gate open.

export type Platform = "soundcloud" | "instagram" | "spotify"

const ANDROID_PACKAGE: Record<Platform, string> = {
  instagram: "com.instagram.android",
  soundcloud: "com.soundcloud.android",
  spotify: "com.spotify.music",
}

export type AppLink = { href: string; newTab: boolean }

function instagramHandle(url: URL): string | null {
  const first = url.pathname.split("/").filter(Boolean)[0]
  return first && /^[A-Za-z0-9._]{1,30}$/.test(first) ? first : null
}

export function appLink(platform: Platform, webUrl: string, userAgent: string): AppLink {
  let url: URL
  try {
    url = new URL(webUrl)
  } catch {
    return { href: webUrl, newTab: true }
  }

  if (platform === "instagram" && /Instagram/.test(userAgent)) {
    const handle = instagramHandle(url)
    if (handle) return { href: `instagram://user?username=${handle}`, newTab: false }
  }

  if (/Android/i.test(userAgent)) {
    let host = url.host.replace(/^(www\.|m\.)/, "")
    let path = `${url.pathname}${url.search}`
    if (platform === "instagram") {
      host = "instagram.com"
      const handle = instagramHandle(url)
      if (handle) path = `/_u/${handle}/`
    }
    return {
      href: `intent://${host}${path}#Intent;scheme=https;package=${ANDROID_PACKAGE[platform]};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`,
      newTab: false,
    }
  }

  return { href: webUrl, newTab: !/iPhone|iPad|iPod/.test(userAgent) }
}
