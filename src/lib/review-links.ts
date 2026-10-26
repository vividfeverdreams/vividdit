import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

// Signed links for the "a fan's screenshots need a look" email. The link opens
// a page with Approve / Reject buttons (a GET never decides anything, so mail
// scanners that prefetch links can't approve a fan by accident). Anyone with
// the link can decide that one submission until it expires.

const TTL_DAYS = 14
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sign(payload: string): string {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error("API_KEY_ENCRYPTION_SECRET is not set")
  return createHmac("sha256", `review-link:${secret}`)
    .update(payload)
    .digest("base64url")
    .slice(0, 32)
}

export function reviewToken(submissionId: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + TTL_DAYS * 86400
  const payload = `${submissionId}.${expires.toString(36)}`
  return `${payload}.${sign(payload)}`
}

/** Returns the submission id for a valid, unexpired token, else null. */
export function verifyReviewToken(token: string, now = Date.now()): string | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [submissionId, expiresRaw, signature] = parts
  if (!UUID.test(submissionId)) return null
  const expected = Buffer.from(sign(`${submissionId}.${expiresRaw}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  const expires = parseInt(expiresRaw, 36)
  if (!Number.isFinite(expires) || expires * 1000 < now) return null
  return submissionId
}

export function reviewUrl(submissionId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")
  return `${base}/review/${reviewToken(submissionId)}`
}
