// Per-gate client-side ad tracking. These are public pixel IDs only — no
// secrets. Shared between the fan page (load + PageView) and the unlock panel
// (download conversion).

export type GateTracking = {
  facebookPixelId: string | null
  googleAdsTagId: string | null
  googleConversionLabel: string | null
  tiktokPixelId: string | null
}

export function hasAnyTracking(t: GateTracking | null | undefined): boolean {
  return (
    !!t &&
    !!(
      t.facebookPixelId ||
      t.googleAdsTagId ||
      t.tiktokPixelId
    )
  )
}

/**
 * Fires the download/unlock conversion on whichever pixels actually loaded
 * (they only exist after the fan accepted consent). Safe no-op otherwise.
 */
export function fireDownloadConversion(t: GateTracking) {
  if (typeof window === "undefined") return
  const w = window as unknown as {
    fbq?: (...a: unknown[]) => void
    gtag?: (...a: unknown[]) => void
    ttq?: { track: (...a: unknown[]) => void }
  }
  try {
    if (t.facebookPixelId && w.fbq) w.fbq("track", "Lead")
    if (t.googleAdsTagId && t.googleConversionLabel && w.gtag) {
      w.gtag("event", "conversion", {
        send_to: `${t.googleAdsTagId}/${t.googleConversionLabel}`,
      })
    }
    if (t.tiktokPixelId && w.ttq) w.ttq.track("CompleteRegistration")
  } catch {
    // tracking must never break the download
  }
}
