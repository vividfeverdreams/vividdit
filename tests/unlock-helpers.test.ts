import { describe, expect, it } from "vitest"

import { isBotUserAgent } from "@/lib/bots"
import { gateTheme } from "@/lib/colors"
import { appLink } from "@/lib/deep-links"
import { hasDownloadAccess } from "@/lib/downloads"
import { countAsks, HEAVY_GATE_ASKS } from "@/lib/gate-asks"
import { reviewToken, verifyReviewToken } from "@/lib/review-links"
import { isStaleReview } from "@/lib/unlock"
import { isVisitorId } from "@/lib/visitor-id"

const SUBMISSION = "33333333-3333-4333-8333-333333333333"
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1"
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"
const INSTAGRAM_APP = `${IPHONE} Instagram 400.0.0.0`

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("download access", () => {
  it("opens on approval, and while a check is open once unlocked", () => {
    expect(hasDownloadAccess({ status: "approved", unlocked_at: null })).toBe(true)
    expect(hasDownloadAccess({ status: "verifying", unlocked_at: "2026-10-27" })).toBe(true)
    expect(hasDownloadAccess({ status: "needs_review", unlocked_at: "2026-10-27" })).toBe(true)
  })

  it("stays shut before unlock and after a rejection", () => {
    expect(hasDownloadAccess({ status: "pending", unlocked_at: null })).toBe(false)
    expect(hasDownloadAccess({ status: "needs_review", unlocked_at: null })).toBe(false)
    expect(hasDownloadAccess({ status: "rejected", unlocked_at: "2026-10-27" })).toBe(false)
  })
})

describe("24-hour auto-approve", () => {
  const now = Date.parse("2026-10-28T12:00:00Z")

  it("approves a review once it has waited a day", () => {
    expect(
      isStaleReview(
        { status: "needs_review", review_started_at: "2026-10-27T11:59:00Z", created_at: "2026-10-20T00:00:00Z" },
        now
      )
    ).toBe(true)
  })

  it("counts from when the review started, not when the fan began", () => {
    expect(
      isStaleReview(
        { status: "needs_review", review_started_at: "2026-10-28T01:00:00Z", created_at: "2026-10-20T00:00:00Z" },
        now
      )
    ).toBe(false)
  })

  it("falls back to the submission date for older reviews", () => {
    expect(
      isStaleReview({ status: "needs_review", review_started_at: null, created_at: "2026-07-18T00:00:00Z" }, now)
    ).toBe(true)
    expect(
      isStaleReview({ status: "approved", review_started_at: null, created_at: "2026-07-18T00:00:00Z" }, now)
    ).toBe(false)
  })
})

describe("review links", () => {
  it("round-trips a submission id", () => {
    expect(verifyReviewToken(reviewToken(SUBMISSION))).toBe(SUBMISSION)
  })

  it("rejects a tampered or expired link", () => {
    const token = reviewToken(SUBMISSION)
    const other = token.replace(SUBMISSION, "44444444-4444-4444-8444-444444444444")
    expect(verifyReviewToken(other)).toBeNull()
    expect(verifyReviewToken(`${token}x`)).toBeNull()
    expect(verifyReviewToken(token, Date.now() + 15 * 24 * 3600 * 1000)).toBeNull()
  })
})

describe("app deep links", () => {
  it("uses the universal https link in the same tab on iPhone", () => {
    expect(appLink("instagram", "https://instagram.com/vividfeverdreams", IPHONE)).toEqual({
      href: "https://instagram.com/vividfeverdreams",
      newTab: false,
    })
  })

  it("opens a new tab on desktop so the gate stays open", () => {
    const mac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15"
    expect(appLink("spotify", "https://open.spotify.com/artist/x", mac)).toEqual({
      href: "https://open.spotify.com/artist/x",
      newTab: true,
    })
  })

  it("opens the Android app with the web page as fallback", () => {
    const link = appLink("instagram", "https://www.instagram.com/vividfeverdreams/", ANDROID)
    expect(link.newTab).toBe(false)
    expect(link.href).toMatch(/^intent:\/\/instagram\.com\/_u\/vividfeverdreams\/#Intent;/)
    expect(link.href).toContain("package=com.instagram.android")
    expect(link.href).toContain(
      `S.browser_fallback_url=${encodeURIComponent("https://www.instagram.com/vividfeverdreams/")}`
    )
    expect(appLink("soundcloud", "https://soundcloud.com/vividfeverdreams/track", ANDROID).href).toMatch(
      /^intent:\/\/soundcloud\.com\/vividfeverdreams\/track#Intent;scheme=https;package=com\.soundcloud\.android;/
    )
  })

  it("opens profiles natively inside Instagram's in-app browser", () => {
    expect(appLink("instagram", "https://instagram.com/vividfeverdreams", INSTAGRAM_APP).href).toBe(
      "instagram://user?username=vividfeverdreams"
    )
  })
})

describe("gate theme", () => {
  it.each([
    ["#d37932", "#2e2824"],
    ["#18181b", "#0a0a0a"],
    ["#ffffff", "#ffffff"],
    ["#f5d90a", "#fafafa"],
    ["#ff0000", "#808080"],
  ])("keeps text and buttons readable for accent %s on %s", (accent, bg) => {
    const theme = gateTheme(accent, bg)
    expect(contrast(theme.muted, theme.card)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.accent, theme.card)).toBeGreaterThanOrEqual(3)
    expect(contrast(theme.accentFg, theme.accent)).toBeGreaterThanOrEqual(3)
  })
})

describe("gate weight", () => {
  it("counts every ask and flags past three", () => {
    const asks = countAsks({ emailEnabled: true, requireLike: true, requireRepost: true, followCount: 3 })
    expect(asks).toBe(6)
    expect(asks > HEAVY_GATE_ASKS).toBe(true)
    expect(countAsks({ emailEnabled: true, requireLike: false, requireRepost: false, followCount: 2 })).toBe(3)
  })
})

describe("analytics hygiene", () => {
  it("skips link-preview bots but keeps in-app browsers", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true)
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")).toBe(true)
    expect(isBotUserAgent("Mozilla/5.0 HeadlessChrome/141.0")).toBe(true)
    expect(isBotUserAgent(null)).toBe(true)
    expect(isBotUserAgent(INSTAGRAM_APP)).toBe(false)
    expect(isBotUserAgent(ANDROID)).toBe(false)
  })

  it("accepts only random visitor ids", () => {
    expect(isVisitorId("0f8a7c9d2b1e4f6a8c0d1e2f3a4b5c6d")).toBe(true)
    expect(isVisitorId("short")).toBe(false)
    expect(isVisitorId("fan@example.com")).toBe(false)
  })
})
