export const PROOF_BUCKET = "proofs"
export const MAX_PROOF_BYTES = 10 * 1024 * 1024
export const MAX_PROOF_TOTAL_BYTES = 25 * 1024 * 1024
export const MAX_PROOF_FILES = 10
export const MAX_PROOFS_PER_SUBMISSION = 15

export const PROOF_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export const ALLOWED_PROOF_TYPES = Object.keys(PROOF_EXTENSIONS)

export type ProofFileDescriptor = {
  name: string
  size: number
  type: string
}

export type ProofUploadTarget = {
  path: string
  token: string
}

export type ProofUploadPreparation = {
  batchId: string
  expiresAt: string
  targets: ProofUploadTarget[]
}

export type StagedProofUpload = {
  path: string
  name: string
}

export type PrepareProofUploadsResult =
  | ({ ok: true } & ProofUploadPreparation)
  | { ok: false; error: string }

export type CompleteProofUploadsResult =
  | { ok: true; count: number }
  | { ok: false; error: string }

export function proofFileError(file: ProofFileDescriptor): string | null {
  if (!Object.hasOwn(PROOF_EXTENSIONS, file.type)) {
    return "Screenshots must be JPG, PNG, or WEBP."
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return `${file.name || "That screenshot"} doesn't look like a valid image.`
  }
  if (file.size > MAX_PROOF_BYTES) {
    return `${file.name || "That screenshot"} is over 10MB.`
  }
  return null
}

export function proofBatchError(
  files: ProofFileDescriptor[],
  maxFiles = MAX_PROOF_FILES
): string | null {
  if (files.length === 0) return "Add at least one screenshot."
  if (files.length > maxFiles) return `Up to ${maxFiles} screenshots.`
  if (files.reduce((total, file) => total + file.size, 0) > MAX_PROOF_TOTAL_BYTES) {
    return "Screenshots must be 25MB or less in total."
  }
  for (const file of files) {
    const error = proofFileError(file)
    if (error) return error
  }
  return null
}
