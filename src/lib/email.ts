import "server-only"

import { getDecryptedResendKey } from "@/lib/email-keys"
import { createAdminClient } from "@/lib/supabase/admin"

// Fan-facing transactional email is sent on the CREATOR's own Resend key
// (BYOK) — the platform key is never billed for an artist's fans. If a creator
// hasn't configured Resend, the email is skipped (logged) and the fan relies
// on their durable status-page download link.
//
// Creator-facing alerts (a review waiting, a broken key) prefer the platform
// key when one is configured and fall back to the creator's own key, sent to
// the address they sign in with.

type EmailBody = {
  to: string
  subject: string
  html: string
  // Resend drops a repeat send with the same key for 24 hours, so a request
  // that timed out after Resend accepted it can't reach the fan twice.
  idempotencyKey?: string
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function postResend(
  key: string,
  from: string,
  { idempotencyKey, ...body }: EmailBody
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, ...body }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Resend failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

/** Returns false when the creator has no Resend key, so nothing was sent. */
async function sendAsCreator(creatorId: string, body: EmailBody): Promise<boolean> {
  const creds = await getDecryptedResendKey(creatorId)
  if (!creds) {
    console.log(
      `[email:skip] creator ${creatorId} has no Resend key — not sending "${body.subject}"`
    )
    return false
  }
  await postResend(creds.key, creds.from, body)
  return true
}

/** Emails the creator at their sign-in address. Returns false if it couldn't. */
export async function sendToCreator(
  creatorId: string,
  body: Omit<EmailBody, "to">
): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(creatorId)
  const to = data.user?.email
  if (!to) return false

  const platformKey = process.env.RESEND_API_KEY
  const platformFrom = process.env.EMAIL_FROM
  if (platformKey && platformFrom) {
    await postResend(platformKey, platformFrom, { to, ...body })
    return true
  }
  return sendAsCreator(creatorId, { to, ...body })
}

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;padding:12px 20px;background:#18181b;color:#fafafa;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a>`

const footer = (artist: string) =>
  `<p style="color:#71717a;font-size:13px;">Sent via Vividdit on behalf of ${escapeHtml(artist)}.</p>`

export async function sendDownloadEmail(opts: {
  creatorId: string
  to: string
  gateTitle: string
  artist: string
  downloadToken: string
  idempotencyKey?: string
}): Promise<boolean> {
  const url = `${siteUrl()}/download/${opts.downloadToken}`
  return sendAsCreator(opts.creatorId, {
    idempotencyKey: opts.idempotencyKey,
    to: opts.to,
    subject: `Your download: ${opts.gateTitle}`,
    html: `
<p>Thanks for the support!</p>
<p><strong>${escapeHtml(opts.gateTitle)}</strong> by ${escapeHtml(opts.artist)} is ready to download:</p>
<p>${button(url, "Download now")}</p>
<p style="color:#71717a;font-size:13px;">This link works for 72 hours.</p>
${footer(opts.artist)}
`.trim(),
  })
}

export async function sendVaultDownloadEmail(opts: {
  creatorId: string
  to: string
  gateTitle: string
  artist: string
  statusToken: string
  idempotencyKey?: string
}): Promise<boolean> {
  const url = `${siteUrl()}/download/vault/${opts.statusToken}`
  return sendAsCreator(opts.creatorId, {
    idempotencyKey: opts.idempotencyKey,
    to: opts.to,
    subject: `Your vault is unlocked: ${opts.gateTitle}`,
    html: `
<p>Thanks for the support!</p>
<p><strong>${escapeHtml(opts.gateTitle)}</strong> by ${escapeHtml(opts.artist)} is unlocked:</p>
<p>${button(url, "Open the vault")}</p>
<p style="color:#71717a;font-size:13px;">Reopen the vault page whenever you need fresh download links.</p>
${footer(opts.artist)}
`.trim(),
  })
}

export async function sendRejectionEmail(opts: {
  creatorId: string
  to: string
  gateTitle: string
  artist: string
  reason: string | null
  gateUrl: string
}): Promise<boolean> {
  return sendAsCreator(opts.creatorId, {
    to: opts.to,
    subject: `Action needed: your download of ${opts.gateTitle}`,
    html: `
<p>We couldn't verify your proof for <strong>${escapeHtml(opts.gateTitle)}</strong> by ${escapeHtml(opts.artist)}.</p>
${opts.reason ? `<p>${escapeHtml(opts.reason)}</p>` : ""}
<p><a href="${opts.gateUrl}">Try again with clearer screenshots</a>.</p>
${footer(opts.artist)}
`.trim(),
  })
}

export async function sendReviewNeededEmail(opts: {
  creatorId: string
  gateTitle: string
  fanEmail: string | null
  aiNote: string | null
  reviewUrl: string
}): Promise<boolean> {
  return sendToCreator(opts.creatorId, {
    subject: `A fan's screenshots need a look: ${opts.gateTitle}`,
    html: `
<p>A fan unlocked <strong>${escapeHtml(opts.gateTitle)}</strong>, but the AI wasn't sure about their screenshots.</p>
${opts.fanEmail ? `<p>Fan: ${escapeHtml(opts.fanEmail)}</p>` : ""}
${opts.aiNote ? `<p style="color:#52525b;">AI note: “${escapeHtml(opts.aiNote)}”</p>` : ""}
<p>${button(opts.reviewUrl, "Look and decide")}</p>
<p style="color:#71717a;font-size:13px;">If you don't decide, it's approved automatically 24 hours after it arrived.</p>
`.trim(),
  })
}

export async function sendKeyAlertEmail(opts: {
  creatorId: string
  provider: string
  error: string
}): Promise<boolean> {
  return sendToCreator(opts.creatorId, {
    subject: "Vividdit: your verification key stopped working",
    html: `
<p>Your ${escapeHtml(opts.provider)} key failed its check:</p>
<p style="color:#b91c1c;">${escapeHtml(opts.error)}</p>
<p>Until it's fixed, fans on your Verified gates still get their download, but nobody checks their screenshots.</p>
<p>${button(`${siteUrl()}/dashboard/settings`, "Fix it in Settings")}</p>
`.trim(),
  })
}
