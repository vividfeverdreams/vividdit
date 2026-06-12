import { NextResponse, type NextRequest } from "next/server"

import { redeemDownloadToken } from "@/lib/downloads"

// Email-link redemption: /download/<raw token> → fresh short-lived signed URL.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const result = await redeemDownloadToken(token)

  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "This download link isn't valid.",
      expired: "This download link has expired. Ask the artist for a new one.",
      exhausted: "This download link has been used too many times.",
      unavailable: "The file isn't available right now. Try again later.",
    }
    return new NextResponse(messages[result.reason], {
      status: result.reason === "not_found" ? 404 : 410,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }

  return NextResponse.redirect(result.signedUrl, 302)
}
