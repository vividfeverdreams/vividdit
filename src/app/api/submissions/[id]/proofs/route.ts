import { after, NextResponse, type NextRequest } from "next/server"

import { exactHash, hammingDistance, perceptualHash } from "@/lib/image-hash"
import { createAdminClient } from "@/lib/supabase/admin"
import { runVerification } from "@/lib/verification"

const MAX_PROOFS_PER_SUBMISSION = 15
const NEAR_DUP_HAMMING = 8

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
  const platformRaw = form.get("platform")
  const platform =
    typeof platformRaw === "string" &&
    ["soundcloud", "instagram", "spotify"].includes(platformRaw)
      ? platformRaw
      : "soundcloud"
  // Stepped flow uploads one platform at a time and finalizes after the last
  // step; legacy/resubmit callers omit the flag and verify immediately.
  const finalize = form.get("finalize") !== "false"

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

  // Cap total proofs per submission (resubmissions accumulate).
  const { count: existingCount } = await admin
    .from("proof_images")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submission.id)
  if ((existingCount ?? 0) + prepared.length > MAX_PROOFS_PER_SUBMISSION) {
    return NextResponse.json(
      { error: "Too many screenshots on this submission." },
      { status: 429 }
    )
  }

  // Near-duplicates of other fans' proofs on this gate aren't blocked (could
  // be legit similar screenshots), but they flag the submission for review.
  const { data: gateProofs } = await admin
    .from("proof_images")
    .select("perceptual_hash, submissions!inner(gate_id)")
    .eq("submissions.gate_id", submission.gate_id)
    .neq("submission_id", submission.id)
    .not("perceptual_hash", "is", null)
    .limit(2000)
  const nearDup = prepared.some((p) =>
    (gateProofs ?? []).some(
      (g) =>
        p.perceptual &&
        g.perceptual_hash &&
        hammingDistance(p.perceptual, g.perceptual_hash) <= NEAR_DUP_HAMMING
    )
  )
  if (nearDup) {
    const { data: sub } = await admin
      .from("submissions")
      .select("fraud_flags")
      .eq("id", submission.id)
      .single()
    const flags = new Set([
      ...(((sub?.fraud_flags as string[]) ?? []) || []),
      "similar_screenshot",
    ])
    await admin
      .from("submissions")
      .update({ fraud_flags: [...flags] })
      .eq("id", submission.id)
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
    stored.map((s) => ({ submission_id: submission.id, platform, ...s }))
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

  if (finalize) {
    await admin.from("events").insert({
      gate_id: submission.gate_id,
      submission_id: submission.id,
      event_type: "submit",
    })
    // Verify after the response is sent — the fan sees "verifying" and the
    // result lands seconds later.
    after(() => runVerification(submission.id))
  }

  return NextResponse.json({ ok: true, count: stored.length })
}
