import "server-only"

import { getDecryptedResendKey } from "@/lib/email-keys"

// Fan-facing transactional email is sent on the CREATOR's own Resend key
// (BYOK) — the platform key is never billed for an artist's fans. If a creator
// hasn't configured Resend, the email is skipped (logged) and the fan relies
// on their durable status-page download link.

type EmailBody = {
  to: string
  subject: string
  html: string
}

async function sendAsCreator(creatorId: string, body: EmailBody): Promise<void> {
  const creds = await getDecryptedResendKey(creatorId)
  if (!creds) {
    console.log(
      `[email:skip] creator ${creatorId} has no Resend key — not sending "${body.subject}" to ${body.to}`
    )
    return
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: creds.from, ...body }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Resend failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

export async function sendDownloadEmail(opts: {
  creatorId: string
  to: string
  gateTitle: string
  artist: string
  downloadToken: string
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  const url = `${base}/download/${opts.downloadToken}`
  await sendAsCreator(opts.creatorId, {
    to: opts.to,
    subject: `Your download is ready — ${opts.gateTitle}`,
    html: `
<p>Your proof was approved! 🎉</p>
<p><strong>${opts.gateTitle}</strong> by ${opts.artist} is ready to download:</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fafafa;border-radius:8px;text-decoration:none;">Download now</a></p>
<p style="color:#71717a;font-size:13px;">This link works for 72 hours. Sent via Vividdit on behalf of ${opts.artist}.</p>
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
}): Promise<void> {
  await sendAsCreator(opts.creatorId, {
    to: opts.to,
    subject: `Action needed — your download of ${opts.gateTitle}`,
    html: `
<p>We couldn't verify your proof for <strong>${opts.gateTitle}</strong> by ${opts.artist}.</p>
${opts.reason ? `<p>${opts.reason}</p>` : ""}
<p><a href="${opts.gateUrl}">Try again with clearer screenshots</a>.</p>
<p style="color:#71717a;font-size:13px;">Sent via Vividdit on behalf of ${opts.artist}.</p>
`.trim(),
  })
}
