import "server-only"

import { randomUUID } from "node:crypto"
import { after } from "next/server"

import { exactHash, hammingDistance, perceptualHash } from "@/lib/image-hash"
import {
  MAX_PROOF_BYTES,
  MAX_PROOF_FILES,
  MAX_PROOF_TOTAL_BYTES,
  PROOF_BUCKET,
  PROOF_EXTENSIONS,
  proofBatchError,
  type ProofFileDescriptor,
  type ProofUploadPreparation,
  type StagedProofUpload,
} from "@/lib/proof-upload-contract"
import { createAdminClient } from "@/lib/supabase/admin"
import { runVerification } from "@/lib/verification"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAGED_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i
const NEAR_DUP_HAMMING = 8

type AdminClient = ReturnType<typeof createAdminClient>
type Submission = {
  id: string
  gate_id: string
  status: string
}

type ProofPlatform = "soundcloud" | "instagram" | "spotify"

type ReservedBatch = {
  batchId: string
  expiresAt: string
  submission: Submission
  paths: string[]
}

type PreparedProof = {
  storage_path: string
  exact_hash: string
  perceptual_hash: string | null
  byte_size: number
}

class ProofUploadFailure extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = "ProofUploadFailure"
  }
}

function fail(message: string, status = 400): never {
  throw new ProofUploadFailure(message, status)
}

export function publicProofUploadError(error: unknown): {
  message: string
  status: number
  expected: boolean
} {
  if (error instanceof ProofUploadFailure) {
    return { message: error.message, status: error.status, expected: true }
  }
  return {
    message: "Couldn't process the screenshots. Try again.",
    status: 500,
    expected: false,
  }
}

function failDatabase(error: unknown, fallback: string): never {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : ""
  const expected: Array<[string, number]> = [
    ["Submission not found.", 404],
    ["Upload batch not found.", 404],
    ["not accepting screenshots", 409],
    ["no longer active", 409],
    ["upload expired", 410],
    ["Too many screenshots", 429],
    ["25MB or less in total", 400],
    ["same screenshot was uploaded more than once", 409],
    ["already used for this gate", 409],
    ["already attached to this submission", 409],
    ["do not match this batch", 400],
    ["Invalid proof", 400],
  ]
  for (const [fragment, status] of expected) {
    if (message.toLowerCase().includes(fragment.toLowerCase())) {
      const start = message.toLowerCase().indexOf(fragment.toLowerCase())
      const friendly = message.slice(start).split("\n")[0]
      fail(friendly, status)
    }
  }
  fail(fallback, 500)
}

function normalizeDescriptors(input: unknown): ProofFileDescriptor[] {
  if (!Array.isArray(input)) fail("Invalid upload.")
  if (input.length === 0 || input.length > MAX_PROOF_FILES) {
    fail(`Upload between 1 and ${MAX_PROOF_FILES} screenshots.`)
  }
  const files = input.map((item) => {
    if (!item || typeof item !== "object") fail("Invalid upload.")
    const value = item as Record<string, unknown>
    if (
      typeof value.name !== "string" ||
      typeof value.type !== "string" ||
      typeof value.size !== "number"
    ) {
      fail("Invalid upload.")
    }
    return {
      name: value.name.slice(0, 240) || "Screenshot",
      type: value.type,
      size: value.size,
    }
  })
  const error = proofBatchError(files, MAX_PROOF_FILES)
  if (error) fail(error)
  return files
}

function normalizeStagedUploads(input: unknown): StagedProofUpload[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_PROOF_FILES) {
    fail(`Upload between 1 and ${MAX_PROOF_FILES} screenshots.`)
  }
  const uploads = input.map((item) => {
    if (!item || typeof item !== "object") fail("Invalid upload.")
    const value = item as Record<string, unknown>
    if (typeof value.path !== "string" || typeof value.name !== "string") {
      fail("Invalid upload.")
    }
    return {
      path: value.path,
      name: value.name.slice(0, 240) || "Screenshot",
    }
  })
  if (new Set(uploads.map((upload) => upload.path)).size !== uploads.length) {
    fail("The same screenshot was submitted more than once.")
  }
  return uploads
}

function validateCapability(
  submissionId: string,
  statusToken: string,
  batchId?: string
) {
  if (
    !UUID.test(submissionId) ||
    !UUID.test(statusToken) ||
    (batchId !== undefined && !UUID.test(batchId))
  ) {
    fail("Submission not found.", 404)
  }
}

async function loadSubmission(
  admin: AdminClient,
  submissionId: string,
  statusToken: string
): Promise<Submission> {
  validateCapability(submissionId, statusToken)
  const { data, error } = await admin
    .from("submissions")
    .select("id, gate_id, status")
    .eq("id", submissionId)
    .eq("status_token", statusToken)
    .maybeSingle()

  if (error) fail("Couldn't check the submission. Try again.", 500)
  if (!data) fail("Submission not found.", 404)
  if (!["pending", "rejected"].includes(data.status)) {
    fail("This submission isn't accepting screenshots.", 409)
  }
  return data as Submission
}

function stagedPrefix(submission: Submission, batchId: string): string {
  return `${submission.gate_id}/${submission.id}/uploads/${batchId}/`
}

function stagedPath(
  submission: Submission,
  batchId: string,
  type: string
): string {
  if (!Object.hasOwn(PROOF_EXTENSIONS, type)) fail("Invalid upload.")
  const ext = PROOF_EXTENSIONS[type as keyof typeof PROOF_EXTENSIONS]
  return `${stagedPrefix(submission, batchId)}${randomUUID()}.${ext}`
}

function isStagedPath(
  submission: Submission,
  batchId: string,
  path: string
): boolean {
  const prefix = stagedPrefix(submission, batchId)
  return path.startsWith(prefix) && STAGED_FILE.test(path.slice(prefix.length))
}

async function removeObjects(admin: AdminClient, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true
  const { error } = await admin.storage.from(PROOF_BUCKET).remove(paths)
  if (error) {
    console.error("[proof-upload] staged object cleanup failed", error.message)
    return false
  }
  return true
}

async function markBatchCleaned(admin: AdminClient, batchId: string) {
  const { error } = await admin.rpc("mark_proof_upload_batch_cleaned", {
    p_batch_id: batchId,
  })
  if (error) {
    console.error("[proof-upload] couldn't mark batch cleaned", error.message)
  }
}

async function discardBatchAndObjects(
  admin: AdminClient,
  input: {
    batchId: string
    submissionId: string
    statusToken: string
  },
  suppressErrors = false
): Promise<void> {
  const { data, error } = await admin.rpc("discard_proof_upload_batch", {
    p_batch_id: input.batchId,
    p_submission_id: input.submissionId,
    p_status_token: input.statusToken,
  })
  if (error) {
    if (suppressErrors) {
      console.error("[proof-upload] batch discard failed", error.message)
      return
    }
    failDatabase(error, "Couldn't discard the screenshot upload. Try again.")
  }

  const row = Array.isArray(data)
    ? (data[0] as { owned_paths?: unknown } | undefined)
    : undefined
  const paths = Array.isArray(row?.owned_paths)
    ? row.owned_paths.filter((path): path is string => typeof path === "string")
    : []
  if (paths.length > 0 && (await removeObjects(admin, paths))) {
    // The database only marks the batch cleaned after its signed URLs expire;
    // a late PUT remains eligible for the cron's second cleanup pass.
    await markBatchCleaned(admin, input.batchId)
  }
}

async function reserveProofUploadBatch(
  admin: AdminClient,
  input: {
    submissionId: string
    statusToken: string
    files: ProofFileDescriptor[]
  }
): Promise<ReservedBatch> {
  const submission = await loadSubmission(
    admin,
    input.submissionId,
    input.statusToken
  )
  const batchId = randomUUID()
  const paths = input.files.map((file) =>
    stagedPath(submission, batchId, file.type)
  )
  const { data, error } = await admin.rpc("reserve_proof_upload_batch", {
    p_batch_id: batchId,
    p_submission_id: submission.id,
    p_status_token: input.statusToken,
    p_storage_paths: paths,
  })
  if (error) {
    failDatabase(error, "Couldn't prepare the screenshot upload. Try again.")
  }
  const row = Array.isArray(data)
    ? (data[0] as { batch_id?: unknown; expires_at?: unknown } | undefined)
    : undefined
  if (row?.batch_id !== batchId || typeof row.expires_at !== "string") {
    fail("Couldn't prepare the screenshot upload. Try again.", 500)
  }
  return {
    batchId,
    expiresAt: row.expires_at,
    submission,
    paths,
  }
}

export async function createProofUploadTargets(input: {
  submissionId: string
  statusToken: string
  files: ProofFileDescriptor[]
}): Promise<ProofUploadPreparation> {
  const files = normalizeDescriptors(input.files)
  const admin = createAdminClient()
  // An artist's revocation is final: no new screenshots for that submission.
  const { data: flagged } = await admin
    .from("submissions")
    .select("fraud_flags")
    .eq("id", input.submissionId)
    .eq("status_token", input.statusToken)
    .maybeSingle()
  if (((flagged?.fraud_flags as string[] | null) ?? []).includes("revoked")) {
    fail("This submission is not accepting screenshots.", 409)
  }
  const reserved = await reserveProofUploadBatch(admin, {
    submissionId: input.submissionId,
    statusToken: input.statusToken,
    files,
  })

  try {
    const targets = []
    for (const path of reserved.paths) {
      const { data, error } = await admin.storage
        .from(PROOF_BUCKET)
        .createSignedUploadUrl(path, { upsert: false })
      if (error || !data?.token) {
        fail("Couldn't prepare the screenshot upload. Try again.", 500)
      }
      targets.push({ path, token: data.token })
    }
    return {
      batchId: reserved.batchId,
      expiresAt: reserved.expiresAt,
      targets,
    }
  } catch (error) {
    await discardBatchAndObjects(
      admin,
      {
        batchId: reserved.batchId,
        submissionId: input.submissionId,
        statusToken: input.statusToken,
      },
      true
    )
    throw error
  }
}

export async function discardStagedProofUploads(input: {
  submissionId: string
  statusToken: string
  batchId: string
}): Promise<void> {
  validateCapability(input.submissionId, input.statusToken, input.batchId)
  const admin = createAdminClient()
  await discardBatchAndObjects(admin, input)
}

type BatchCompletionState = {
  completed: boolean
  count: number
  submissionStatus: string | null
}

async function inspectBatchCompletion(
  admin: AdminClient,
  input: {
    submissionId: string
    statusToken: string
    batchId: string
    expectedPaths?: string[]
  }
): Promise<BatchCompletionState> {
  validateCapability(input.submissionId, input.statusToken, input.batchId)
  const { data: submission, error: submissionError } = await admin
    .from("submissions")
    .select("status")
    .eq("id", input.submissionId)
    .eq("status_token", input.statusToken)
    .maybeSingle()
  if (submissionError) fail("Couldn't check the screenshot upload. Try again.", 500)
  if (!submission) fail("Submission not found.", 404)

  const { data: batch, error: batchError } = await admin
    .from("proof_upload_batches")
    .select("status, storage_paths")
    .eq("id", input.batchId)
    .eq("submission_id", input.submissionId)
    .maybeSingle()
  if (batchError) fail("Couldn't check the screenshot upload. Try again.", 500)
  if (!batch || batch.status !== "completed") {
    return { completed: false, count: 0, submissionStatus: submission.status }
  }

  const paths = Array.isArray(batch.storage_paths)
    ? batch.storage_paths.filter(
        (path: unknown): path is string => typeof path === "string"
      )
    : []
  if (
    paths.length === 0 ||
    (input.expectedPaths &&
      (input.expectedPaths.length !== paths.length ||
        input.expectedPaths.some((path) => !paths.includes(path))))
  ) {
    fail("The uploaded screenshots do not match this batch.", 400)
  }

  const { count, error: proofError } = await admin
    .from("proof_images")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", input.submissionId)
    .in("storage_path", paths)
  if (proofError) fail("Couldn't check the screenshot upload. Try again.", 500)
  if (count !== paths.length) {
    fail("Couldn't check the screenshot upload. Try again.", 500)
  }
  return {
    completed: true,
    count,
    submissionStatus: submission.status,
  }
}

export async function reconcileProofUploadBatch(input: {
  submissionId: string
  statusToken: string
  batchId: string
}): Promise<{ completed: boolean; count: number }> {
  const admin = createAdminClient()
  const state = await inspectBatchCompletion(admin, input)
  if (state.completed && state.submissionStatus === "verifying") {
    after(() => runVerification(input.submissionId, input.statusToken))
  }
  return { completed: state.completed, count: state.count }
}

export async function completeStagedProofUploads(input: {
  submissionId: string
  statusToken: string
  batchId: string
  uploads: StagedProofUpload[]
  finalize: boolean
  platform?: ProofPlatform
  followTargetId?: string | null
}): Promise<number> {
  const uploads = normalizeStagedUploads(input.uploads)
  validateCapability(input.submissionId, input.statusToken, input.batchId)
  const admin = createAdminClient()
  let proofCount = 0
  let shouldVerify = false

  try {
    const submission = await loadSubmission(
      admin,
      input.submissionId,
      input.statusToken
    )
    if (
      uploads.some(
        (upload) => !isStagedPath(submission, input.batchId, upload.path)
      )
    ) {
      fail("Invalid upload path.", 400)
    }

    const prepared: PreparedProof[] = []
    let totalBytes = 0
    for (const upload of uploads) {
      const { data: blob, error } = await admin.storage
        .from(PROOF_BUCKET)
        .download(upload.path)
      if (error || !blob) {
        fail(`Couldn't load ${upload.name}. Upload it again.`, 400)
      }
      if (blob.size <= 0 || blob.size > MAX_PROOF_BYTES) {
        fail(
          blob.size > MAX_PROOF_BYTES
            ? `${upload.name} is over 10MB.`
            : `${upload.name} doesn't look like a valid image.`,
          400
        )
      }
      totalBytes += blob.size
      if (totalBytes > MAX_PROOF_TOTAL_BYTES) {
        fail("Screenshots must be 25MB or less in total.", 400)
      }

      const bytes = Buffer.from(await blob.arrayBuffer())
      let perceptual: string | null
      try {
        perceptual = await perceptualHash(bytes)
      } catch {
        fail(`${upload.name} doesn't look like a valid image.`, 400)
      }
      prepared.push({
        storage_path: upload.path,
        exact_hash: exactHash(bytes),
        perceptual_hash: perceptual,
        byte_size: blob.size,
      })
    }

    if (new Set(prepared.map((proof) => proof.exact_hash)).size !== prepared.length) {
      fail("The same screenshot was uploaded more than once.", 409)
    }

    const hashes = prepared.map((proof) => proof.exact_hash)
    const { data: dupes, error: dupesError } = await admin
      .from("proof_images")
      .select("exact_hash, submission_id, submissions!inner(gate_id)")
      .in("exact_hash", hashes)
      .eq("submissions.gate_id", submission.gate_id)
    if (dupesError) fail("Couldn't check the screenshots. Try again.", 500)
    if ((dupes ?? []).some((dupe) => dupe.submission_id !== submission.id)) {
      fail(
        "One of these screenshots was already used for this gate. Take fresh screenshots of your own account.",
        409
      )
    }
    if ((dupes ?? []).some((dupe) => dupe.submission_id === submission.id)) {
      fail("One of these screenshots is already attached to this submission.", 409)
    }

    const { data: gateProofs, error: gateProofsError } = await admin
      .from("proof_images")
      .select("perceptual_hash, submissions!inner(gate_id)")
      .eq("submissions.gate_id", submission.gate_id)
      .neq("submission_id", submission.id)
      .not("perceptual_hash", "is", null)
      .limit(2000)
    if (gateProofsError) fail("Couldn't check the screenshots. Try again.", 500)

    const nearDuplicate = prepared.some((proof) =>
      (gateProofs ?? []).some(
        (existing) =>
          proof.perceptual_hash &&
          existing.perceptual_hash &&
          hammingDistance(proof.perceptual_hash, existing.perceptual_hash) <=
            NEAR_DUP_HAMMING
      )
    )

    const platform = ["soundcloud", "instagram", "spotify"].includes(
      input.platform ?? ""
    )
      ? input.platform!
      : "soundcloud"
    const followTargetId =
      typeof input.followTargetId === "string" && UUID.test(input.followTargetId)
        ? input.followTargetId
        : null

    const { data, error } = await admin.rpc("complete_proof_upload_batch", {
      p_batch_id: input.batchId,
      p_submission_id: submission.id,
      p_status_token: input.statusToken,
      p_proofs: prepared,
      p_platform: platform,
      p_follow_target_id: followTargetId,
      p_near_duplicate: nearDuplicate,
      p_finalize: input.finalize,
    })
    const expectedPaths = uploads.map((upload) => upload.path)
    if (error) {
      const recovered = await inspectBatchCompletion(admin, {
        submissionId: input.submissionId,
        statusToken: input.statusToken,
        batchId: input.batchId,
        expectedPaths,
      })
      if (!recovered.completed) {
        failDatabase(error, "Couldn't record the screenshots. Try again.")
      }
      proofCount = recovered.count
      shouldVerify = recovered.submissionStatus === "verifying"
    }
    const row = Array.isArray(data)
      ? (data[0] as {
          proof_count?: unknown
          should_verify?: unknown
        } | undefined)
      : undefined
    if (!error) {
      if (
        !row ||
        typeof row.proof_count !== "number" ||
        typeof row.should_verify !== "boolean"
      ) {
        const recovered = await inspectBatchCompletion(admin, {
          submissionId: input.submissionId,
          statusToken: input.statusToken,
          batchId: input.batchId,
          expectedPaths,
        })
        if (!recovered.completed) {
          fail("Couldn't record the screenshots. Try again.", 500)
        }
        proofCount = recovered.count
        shouldVerify = recovered.submissionStatus === "verifying"
      } else {
        proofCount = row.proof_count
        shouldVerify = row.should_verify
      }
    }
  } catch (error) {
    await discardBatchAndObjects(
      admin,
      {
        batchId: input.batchId,
        submissionId: input.submissionId,
        statusToken: input.statusToken,
      },
      true
    )
    throw error
  }

  if (shouldVerify) {
    after(() => runVerification(input.submissionId, input.statusToken))
  }
  return proofCount
}

export async function ingestLegacyProofFiles(input: {
  submissionId: string
  statusToken: string
  files: File[]
  finalize: boolean
  platform?: ProofPlatform
  followTargetId?: string | null
}): Promise<number> {
  const descriptors = normalizeDescriptors(
    input.files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    }))
  )
  const admin = createAdminClient()
  const reserved = await reserveProofUploadBatch(admin, {
    submissionId: input.submissionId,
    statusToken: input.statusToken,
    files: descriptors,
  })
  const uploads = reserved.paths.map((path, index) => ({
    path,
    name: descriptors[index].name,
  }))

  try {
    for (const [index, file] of input.files.entries()) {
      const bytes = Buffer.from(await file.arrayBuffer())
      const { error } = await admin.storage
        .from(PROOF_BUCKET)
        .upload(uploads[index].path, bytes, {
          contentType: file.type,
          upsert: false,
        })
      if (error) fail("Couldn't store the screenshots. Try again.", 500)
    }
  } catch (error) {
    await discardBatchAndObjects(
      admin,
      {
        batchId: reserved.batchId,
        submissionId: input.submissionId,
        statusToken: input.statusToken,
      },
      true
    )
    throw error
  }

  return completeStagedProofUploads({
    submissionId: input.submissionId,
    statusToken: input.statusToken,
    batchId: reserved.batchId,
    uploads,
    finalize: input.finalize,
    platform: input.platform,
    followTargetId: input.followTargetId,
  })
}
