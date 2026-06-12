import { NextResponse, type NextRequest } from "next/server"

import { exactHash, perceptualHash } from "@/lib/image-hash"
import { createAdminClient } from "@/lib/supabase/admin"

const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: submissionId } = await params

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 })
  }

  const statusToken = form.get("statusToken")
  const files = form.getAll("proofs").filter((f): f is File => f instanceof File)

  if (typeof statusToken !== "string" || !statusToken) {
    return NextResponse.json({ error: "Missing token." }, { status: 401 })
  }
  if (files.length === 0 || files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Upload between 1 and ${MAX_FILES} screenshots.` },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // The status token is the fan's capability to act on this submission.
  const { data: submission } = await admin
    .from("submissions")
    .select("id, gate_id, status, status_token")
    .eq("id", submissionId)
    .eq("status_token", statusToken)
    .maybeSingle()
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 })
  }
  if (!["pending", "rejected"].includes(submission.status)) {
    return NextResponse.json(
      { error: "This submission isn't accepting screenshots." },
      { status: 409 }
    )
  }

  // Validate everything before persisting anything.
  const prepared: {
    bytes: Buffer
    ext: string
    contentType: string
    exact: string
    perceptual: string | null
  }[] = []

  for (const file of files) {
    const ext = ALLOWED_TYPES.get(file.type)
    if (!ext) {
      return NextResponse.json(
        { error: "Screenshots must be JPG, PNG, or WEBP." },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `${file.name} is over 10MB.` },
        { status: 400 }
      )
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    let perceptual: string | null = null
    try {
      perceptual = await perceptualHash(bytes)
    } catch {
      // sharp couldn't parse it — not a real image.
      return NextResponse.json(
        { error: `${file.name} doesn't look like a valid image.` },
        { status: 400 }
      )
    }
    prepared.push({
      bytes,
      ext,
      contentType: file.type,
      exact: exactHash(bytes),
      perceptual,
    })
  }

  // Block exact duplicates already used on this gate (any submission).
  const { data: dupes } = await admin
    .from("proof_images")
    .select("exact_hash, submission_id, submissions!inner(gate_id)")
    .in(
      "exact_hash",
      prepared.map((p) => p.exact)
    )
    .eq("submissions.gate_id", submission.gate_id)
    .neq("submission_id", submission.id)

  if (dupes && dupes.length > 0) {
    return NextResponse.json(
      {
        error:
          "One of these screenshots was already used for this gate. Take fresh screenshots of your own account.",
      },
      { status: 409 }
    )
  }

  // Persist: storage first, then rows.
  const stored: { storage_path: string; exact_hash: string; perceptual_hash: string | null }[] = []
  for (const [i, p] of prepared.entries()) {
    const path = `${submission.gate_id}/${submission.id}/${Date.now()}-${i}.${p.ext}`
    const { error } = await admin.storage.from("proofs").upload(path, p.bytes, {
      contentType: p.contentType,
      upsert: false,
    })
    if (error) {
      return NextResponse.json(
        { error: "Couldn't store screenshots. Try again." },
        { status: 500 }
      )
    }
    stored.push({
      storage_path: path,
      exact_hash: p.exact,
      perceptual_hash: p.perceptual,
    })
  }

  const { error: rowError } = await admin.from("proof_images").insert(
    stored.map((s) => ({ submission_id: submission.id, ...s }))
  )
  if (rowError) {
    return NextResponse.json(
      { error: "Couldn't record screenshots. Try again." },
      { status: 500 }
    )
  }

  await admin
    .from("submissions")
    .update({ status: "pending" })
    .eq("id", submission.id)

  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submission.id,
    event_type: "submit",
  })

  return NextResponse.json({ ok: true, count: stored.length })
}
