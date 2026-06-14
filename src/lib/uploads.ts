"use client"

import * as tus from "tus-js-client"

import { createClient } from "@/lib/supabase/client"

export type HqUploadResult = {
  storagePath: string
  filename: string
  sizeBytes: number
  mimeType: string
}

const HQ_MIME_FALLBACK = "application/octet-stream"

/**
 * Resumable upload to the private hq-files bucket via Supabase's TUS
 * endpoint. WAV/AIFF files routinely exceed 100MB, where a single POST
 * would be flaky. Chunk size must be exactly 6MB per Supabase docs.
 */
export async function uploadHqFile(
  file: File,
  onProgress: (percent: number) => void
): Promise<HqUploadResult> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error("Not signed in")

  const objectName = `${session.user.id}/${crypto.randomUUID()}/${file.name}`

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: "hq-files",
        objectName,
        contentType: file.type || HQ_MIME_FALLBACK,
        cacheControl: "3600",
      },
      onError: reject,
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    })

    // Resume an interrupted upload of the same file if one exists.
    upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0])
      }
      upload.start()
    })
  })

  return {
    storagePath: objectName,
    filename: file.name,
    sizeBytes: file.size,
    mimeType: file.type || HQ_MIME_FALLBACK,
  }
}

/** Direct browser → R2 upload via a presigned PUT URL (with progress). */
export function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl)
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error("Upload failed"))
    xhr.send(file)
  })
}

/** Standard upload for cover images (small files, public bucket). */
export async function uploadCoverImage(file: File): Promise<string> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error("Not signed in")

  const path = `${session.user.id}/${crypto.randomUUID()}-${file.name}`
  const { error } = await supabase.storage.from("covers").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}
