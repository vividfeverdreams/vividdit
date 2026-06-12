import { NextResponse, type NextRequest } from "next/server"

import { redeemByStatusToken } from "@/lib/downloads"

// On-page download for approved submissions: the fan's status token is the
// capability. Bounded by MAX_STATUS_DOWNLOADS per submission.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ statusToken: string }> }
) {
  const { statusToken } = await params
  if (!/^[0-9a-f-]{36}$/i.test(statusToken)) {
    return new NextResponse("Not found.", { status: 404 })
  }

  const result = await redeemByStatusToken(statusToken)
  if (!result.ok) {
    return new NextResponse(
      result.reason === "exhausted"
        ? "Download limit reached for this unlock."
        : "Download not available.",
      {
        status: result.reason === "not_found" ? 404 : 410,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }
    )
  }

  return NextResponse.redirect(result.signedUrl, 302)
}
