"use server"

import type {
  CompleteProofUploadsResult,
  PrepareProofUploadsResult,
  ProofFileDescriptor,
  StagedProofUpload,
} from "@/lib/proof-upload-contract"
import {
  completeStagedProofUploads,
  createProofUploadTargets,
  discardStagedProofUploads,
  publicProofUploadError,
  reconcileProofUploadBatch,
} from "@/lib/proof-uploads"

export async function prepareProofUploadsAction(input: {
  submissionId: string
  statusToken: string
  files: ProofFileDescriptor[]
}): Promise<PrepareProofUploadsResult> {
  try {
    const prepared = await createProofUploadTargets(input)
    return { ok: true, ...prepared }
  } catch (error) {
    const problem = publicProofUploadError(error)
    if (!problem.expected) console.error("[proof-upload] prepare failed", error)
    return { ok: false, error: problem.message }
  }
}

export async function completeProofUploadsAction(input: {
  submissionId: string
  statusToken: string
  batchId: string
  uploads: StagedProofUpload[]
  // Stepped uploads (one screenshot per step on Verified gates) attach each
  // batch to its step and leave verification for the final unlock.
  finalize?: boolean
  platform?: "soundcloud" | "instagram" | "spotify"
  followTargetId?: string | null
}): Promise<CompleteProofUploadsResult> {
  try {
    const count = await completeStagedProofUploads({
      submissionId: input.submissionId,
      statusToken: input.statusToken,
      batchId: input.batchId,
      uploads: input.uploads,
      finalize: input.finalize !== false,
      platform: input.platform,
      followTargetId: input.followTargetId ?? null,
    })
    return { ok: true, count }
  } catch (error) {
    const problem = publicProofUploadError(error)
    if (!problem.expected) console.error("[proof-upload] completion failed", error)
    return { ok: false, error: problem.message }
  }
}

export async function discardProofUploadsAction(input: {
  submissionId: string
  statusToken: string
  batchId: string
}): Promise<{ ok: boolean }> {
  try {
    await discardStagedProofUploads(input)
    return { ok: true }
  } catch (error) {
    const problem = publicProofUploadError(error)
    if (!problem.expected) console.error("[proof-upload] discard failed", error)
    return { ok: false }
  }
}

export async function reconcileProofUploadBatchAction(input: {
  submissionId: string
  statusToken: string
  batchId: string
}): Promise<{ completed: boolean; count: number }> {
  try {
    return await reconcileProofUploadBatch(input)
  } catch (error) {
    const problem = publicProofUploadError(error)
    if (!problem.expected) console.error("[proof-upload] reconcile failed", error)
    return { completed: false, count: 0 }
  }
}
