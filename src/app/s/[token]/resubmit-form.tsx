"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

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
    if (picked.length > MAX_FILES) {
      setError(`Up to ${MAX_FILES} screenshots.`)
      return
    }
    for (const f of picked) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setError("Screenshots must be JPG, PNG, or WEBP.")
        return
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is over 10MB.`)
        return
      }
    }
    setFiles(picked)
  }

  const submit = async () => {
    if (files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.set("statusToken", statusToken)
      files.forEach((f) => form.append("proofs", f))
      const res = await fetch(`/api/submissions/${submissionId}/proofs`, {
        method: "POST",
        body: form,
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? "Upload failed. Try again.")
        return
      }
      router.refresh()
    } catch {
      setError("Upload failed. Check your connection and try again.")
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
          accept={ALLOWED_TYPES.join(",")}
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
