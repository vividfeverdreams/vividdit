import "server-only"

// Fan-facing transactional email via Resend. Without RESEND_API_KEY (local
// dev), emails are logged to the server console instead of sent.

type EmailInput = {
  to: string
  subject: string
  html: string
}

async function sendEmail(input: EmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? "Vividdit <noreply@vividdit.com>"

  if (!apiKey) {
    console.log(
      `[email:dev] to=${input.to} subject="${input.subject}"\n${input.html}`
    )
    return
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, ...input }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Resend failed (${res.status}): ${body.slice(0, 200)}`)
  }
}

export async function sendDownloadEmail(opts: {
  to: string
  gateTitle: string
  artist: string
  downloadToken: string
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  const url = `${base}/download/${opts.downloadToken}`
  await sendEmail({
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
  to: string
  gateTitle: string
  artist: string
  reason: string | null
  gateUrl: string
}): Promise<void> {
  await sendEmail({
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
