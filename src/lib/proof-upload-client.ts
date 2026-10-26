"use client"

import {
  completeProofUploadsAction,
  discardProofUploadsAction,
  prepareProofUploadsAction,
  reconcileProofUploadBatchAction,
} from "@/app/proof-upload-actions"
import { PROOF_BUCKET } from "@/lib/proof-upload-contract"
import { createClient } from "@/lib/supabase/client"

export class ProofUploadClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProofUploadClientError"
  }
}

export async function uploadProofFiles(input: {
  submissionId: string
  statusToken: string
  files: File[]
  // Set for a single step's screenshot; the whole set is verified on unlock.
  step?: {
    platform: "soundcloud" | "instagram" | "spotify"
    followTargetId: string | null
  }
}): Promise<number> {
  let batchId: string | null = null

  try {
    const prepared = await prepareProofUploadsAction({
      submissionId: input.submissionId,
      statusToken: input.statusToken,
      // Only small metadata crosses the Vercel Function boundary. The File
      // objects themselves go from the browser directly to Supabase Storage.
      files: input.files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    })
    if (!prepared.ok) throw new ProofUploadClientError(prepared.error)
    if (prepared.targets.length !== input.files.length) {
      throw new ProofUploadClientError("Couldn't prepare the screenshot upload. Try again.")
    }

    batchId = prepared.batchId
    const supabase = createClient()
    const bucket = supabase.storage.from(PROOF_BUCKET)
    const results = await Promise.allSettled(
      prepared.targets.map((target, index) =>
        bucket.uploadToSignedUrl(target.path, target.token, input.files[index], {
          contentType: input.files[index].type,
          cacheControl: "3600",
        })
      )
    )
    const failedIndex = results.findIndex(
      (result) => result.status === "rejected" || result.value.error
    )
    if (failedIndex !== -1) {
      throw new ProofUploadClientError(
        `Couldn't upload ${input.files[failedIndex].name}. Check your connection and try again.`
      )
    }

    let completed
    try {
      completed = await completeProofUploadsAction({
        submissionId: input.submissionId,
        statusToken: input.statusToken,
        batchId,
        uploads: prepared.targets.map((target, index) => ({
          path: target.path,
          name: input.files[index].name,
        })),
        ...(input.step
          ? {
              finalize: false,
              platform: input.step.platform,
              followTargetId: input.step.followTargetId,
            }
          : {}),
      })
    } catch (completionError) {
      // A Server Action response can be lost after its database transaction
      // commits. Reconcile the persisted batch before reporting an error or
      // attempting the conditional active -> discarded transition.
      const reconciled = await reconcileProofUploadBatchAction({
        submissionId: input.submissionId,
        statusToken: input.statusToken,
        batchId,
      }).catch(() => ({ completed: false, count: 0 }))
      if (reconciled.completed) {
        batchId = null
        return reconciled.count
      }
      throw completionError
    }
    if (!completed.ok) {
      const reconciled = await reconcileProofUploadBatchAction({
        submissionId: input.submissionId,
        statusToken: input.statusToken,
        batchId,
      }).catch(() => ({ completed: false, count: 0 }))
      if (reconciled.completed) {
        batchId = null
        return reconciled.count
      }
      throw new ProofUploadClientError(completed.error)
    }

    // A completed batch cannot transition to discarded, so even an ambiguous
    // late client error cannot race committed proof rows.
    batchId = null
    return completed.count
  } catch (error) {
    if (batchId) {
      await discardProofUploadsAction({
        submissionId: input.submissionId,
        statusToken: input.statusToken,
        batchId,
      }).catch(() => {})
    }
    if (error instanceof ProofUploadClientError) throw error
    throw new ProofUploadClientError(
      "Upload failed. Check your connection and try again."
    )
  }
}
