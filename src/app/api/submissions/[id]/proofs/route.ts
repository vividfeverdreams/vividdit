import { NextResponse, type NextRequest } from "next/server"

import {
  ingestLegacyProofFiles,
  publicProofUploadError,
} from "@/lib/proof-uploads"

// New clients upload directly to a signed Supabase Storage URL. Keep this
// multipart endpoint for older open tabs and clients, but reject oversized
// bodies early when the request reaches Next.js. Vercel Functions have a hard
// 4.5MB body limit that application config cannot raise.
const MAX_LEGACY_REQUEST_BYTES = 4 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: submissionId } = await params
  const contentLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_LEGACY_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "These screenshots are too large to upload together. Reload and try again." },
      { status: 413 }
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 })
  }

  const statusToken = form.get("statusToken")
  const files = form.getAll("proofs").filter((file): file is File => file instanceof File)
  const platformRaw = form.get("platform")
  const platform =
    typeof platformRaw === "string" &&
    ["soundcloud", "instagram", "spotify"].includes(platformRaw)
      ? (platformRaw as "soundcloud" | "instagram" | "spotify")
      : "soundcloud"
  const followTargetRaw = form.get("followTargetId")
  const followTargetId = typeof followTargetRaw === "string" ? followTargetRaw : null

  if (typeof statusToken !== "string") {
    return NextResponse.json({ error: "Missing token." }, { status: 401 })
  }

  try {
    const count = await ingestLegacyProofFiles({
      submissionId,
      statusToken,
      files,
      finalize: form.get("finalize") !== "false",
      platform,
      followTargetId,
    })
    return NextResponse.json({ ok: true, count })
  } catch (error) {
    const problem = publicProofUploadError(error)
    if (!problem.expected) console.error("[proof-upload] legacy upload failed", error)
    return NextResponse.json({ error: problem.message }, { status: problem.status })
  }
}
