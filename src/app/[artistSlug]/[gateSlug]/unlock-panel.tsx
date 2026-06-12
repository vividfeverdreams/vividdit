"use client"

import { useState, useTransition } from "react"

import { startSubmissionAction } from "@/app/[artistSlug]/[gateSlug]/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

type Requirements = {
  emailEnabled: boolean
  soundcloudEnabled: boolean
  requireLike: boolean
  requireRepost: boolean
  requireFollow: boolean
}

type Track = {
  title: string
  artist: string
  soundcloudUrl: string
  artistProfileUrl: string | null
  artistName: string
}

type Phase =
  | { name: "start" }
  | {
      name: "proofs"
      submissionId: string
      statusToken: string
      proofCode: string
    }
  | { name: "done"; statusToken: string; approved: boolean }

export function UnlockPanel({
  gateId,
  accent,
  requirements,
  track,
}: {
  gateId: string
  accent: string
  requirements: Requirements
  track: Track
}) {
  const [phase, setPhase] = useState<Phase>({ name: "start" })
  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, startTransition] = useTransition()
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)

  const actions = [
    requirements.requireLike && `Like “${track.title}”`,
    requirements.requireRepost && `Repost “${track.title}”`,
    requirements.requireFollow && `Follow ${track.artistName}`,
  ].filter(Boolean) as string[]

  const start = () => {
    setError(null)
    startTransition(async () => {
      const result = await startSubmissionAction({
        gateId,
        email: requirements.emailEnabled ? email.trim() : null,
        consent,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.approved) {
        setPhase({ name: "done", statusToken: result.statusToken, approved: true })
      } else {
        setPhase({
          name: "proofs",
          submissionId: result.submissionId,
          statusToken: result.statusToken,
          proofCode: result.proofCode,
        })
      }
    })
  }

  const onPickFiles = (list: FileList | null) => {
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

  const uploadProofs = async () => {
    if (phase.name !== "proofs" || files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.set("statusToken", phase.statusToken)
      files.forEach((f) => form.append("proofs", f))
      const res = await fetch(`/api/submissions/${phase.submissionId}/proofs`, {
        method: "POST",
        body: form,
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? "Upload failed. Try again.")
        return
      }
      setPhase({ name: "done", statusToken: phase.statusToken, approved: false })
    } catch {
      setError("Upload failed. Check your connection and try again.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {phase.name === "start" && (
          <>
            <div>
              <h2 className="font-medium">Unlock the HQ download</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {requirements.emailEnabled && <li>• Join the artist's email list</li>}
                {actions.map((a) => (
                  <li key={a}>• {a} on SoundCloud</li>
                ))}
              </ul>
            </div>

            {requirements.emailEnabled && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="fanEmail">Your email</Label>
                  <Input
                    id="fanEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 size-4"
                  />
                  I agree to join {track.artistName}&apos;s email list and receive
                  updates about new music. Unsubscribe anytime.
                </label>
              </div>
            )}

            <Button
              onClick={start}
              disabled={starting}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              {starting
                ? "Starting…"
                : requirements.soundcloudEnabled
                  ? "Start unlock"
                  : "Get the download"}
            </Button>
          </>
        )}

        {phase.name === "proofs" && (
          <>
            <div className="space-y-2">
              <h2 className="font-medium">Step 1 — do the actions</h2>
              <ol className="space-y-1 text-sm text-muted-foreground">
                {requirements.requireLike && (
                  <li>
                    1. Open{" "}
                    <a
                      href={track.soundcloudUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                      style={{ color: accent }}
                    >
                      the track
                    </a>{" "}
                    and tap <strong>Like</strong> (heart).
                  </li>
                )}
                {requirements.requireRepost && (
                  <li>
                    {requirements.requireLike ? 2 : 1}. On the same track, tap{" "}
                    <strong>Repost</strong>.
                  </li>
                )}
                {requirements.requireFollow && (
                  <li>
                    {1 +
                      (requirements.requireLike ? 1 : 0) +
                      (requirements.requireRepost ? 1 : 0)}
                    . Open{" "}
                    {track.artistProfileUrl ? (
                      <a
                        href={track.artistProfileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                        style={{ color: accent }}
                      >
                        {track.artistName}&apos;s profile
                      </a>
                    ) : (
                      <strong>{track.artistName}&apos;s profile</strong>
                    )}{" "}
                    and tap <strong>Follow</strong>.
                  </li>
                )}
              </ol>
            </div>

            <div className="space-y-2">
              <h2 className="font-medium">Step 2 — screenshot the proof</h2>
              <p className="text-sm text-muted-foreground">
                {requirements.requireLike || requirements.requireRepost
                  ? "Screenshot the track page showing the liked/reposted state. "
                  : ""}
                {requirements.requireFollow
                  ? "Screenshot the artist profile showing “Following”. "
                  : ""}
                If you can, include your proof code{" "}
                <strong className="font-mono">{phase.proofCode}</strong> visible in
                the screenshot (e.g. in a comment draft or note) — it speeds up
                approval.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="proofFiles">
                Upload screenshots (JPG/PNG/WEBP, up to {MAX_FILES} files, 10MB each)
              </Label>
              <Input
                id="proofFiles"
                type="file"
                multiple
                accept={ALLOWED_TYPES.join(",")}
                onChange={(e) => onPickFiles(e.target.files)}
              />
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </p>
              )}
            </div>

            <Button
              onClick={uploadProofs}
              disabled={uploading || files.length === 0}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              {uploading ? "Uploading…" : "Submit for verification"}
            </Button>
          </>
        )}

        {phase.name === "done" && (
          <div className="space-y-3 text-center">
            {phase.approved ? (
              <>
                <h2 className="text-lg font-semibold">You&apos;re in! 🎉</h2>
                <p className="text-sm text-muted-foreground">
                  Your download is ready.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Proof submitted ✓</h2>
                <p className="text-sm text-muted-foreground">
                  We&apos;re verifying your screenshots — usually under a minute.
                </p>
              </>
            )}
            <Button
              render={<a href={`/s/${phase.statusToken}`} />}
              nativeButton={false}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              {phase.approved ? "Go to your download" : "Check status"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
