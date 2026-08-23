"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ALLOWED_PROOF_TYPES,
  proofBatchError,
} from "@/lib/proof-upload-contract"
import {
  ProofUploadClientError,
  uploadProofFiles,
} from "@/lib/proof-upload-client"

const MAX_FILES = 5

export function ResubmitForm({
  submissionId,
  statusToken,
}: {
  submissionId: string
  statusToken: string
}) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const onPick = (list: FileList | null) => {
    setError(null)
    const picked = [...(list ?? [])]
    const validationError = proofBatchError(picked, MAX_FILES)
    if (validationError) {
      setError(validationError)
      return
    }
    setFiles(picked)
  }

  const submit = async () => {
    if (files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      await uploadProofFiles({
        submissionId,
        statusToken,
        files,
      })
      router.refresh()
    } catch (error) {
      setError(
        error instanceof ProofUploadClientError
          ? error.message
          : "Upload failed. Check your connection and try again."
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="resubmitFiles">Resubmit clearer screenshots</Label>
        <Input
          id="resubmitFiles"
          type="file"
          multiple
          accept={ALLOWED_PROOF_TYPES.join(",")}
          onChange={(e) => onPick(e.target.files)}
        />
      </div>
      <Button
        onClick={submit}
        disabled={uploading || files.length === 0}
        className="w-full"
      >
        {uploading ? "Uploading…" : "Submit again"}
      </Button>
    </div>
  )
}
