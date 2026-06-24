"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  finalizeSubmissionAction,
  getSubmissionStatusAction,
  startSubmissionAction,
} from "@/app/[artistSlug]/[gateSlug]/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { fireDownloadConversion, type GateTracking } from "@/lib/tracking"
import { cn } from "@/lib/utils"

const MAX_BYTES = 10 * 1024 * 1024
const MAX_BATCH = 10
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

const PLATFORM_LABEL: Record<string, string> = {
  soundcloud: "SoundCloud",
  instagram: "Instagram",
  spotify: "Spotify",
}

export type FollowTarget = {
  id: string
  platform: "soundcloud" | "instagram" | "spotify"
  profileUrl: string
  displayName: string
}

type Requirements = {
  emailEnabled: boolean
  requireLike: boolean
  requireRepost: boolean
  requireProofCode: boolean
  followTargets: FollowTarget[]
}

type Track = {
  title: string
  artist: string
  soundcloudUrl: string
  artistName: string
}

type Submission = {
  submissionId: string
  statusToken: string
  proofCode: string
}

type ProofStep = { kind: "track" } | { kind: "follow"; target: FollowTarget }

function fileError(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return "Screenshots must be JPG, PNG, or WEBP."
  if (file.size > MAX_BYTES) return `${file.name} is over 10MB.`
  return null
}

export function UnlockPanel({
  gateId,
  accent,
  requirements,
  track,
  tracking,
}: {
  gateId: string
  accent: string
  requirements: Requirements
  track: Track
  tracking: GateTracking
}) {
  const proofSteps = useMemo<ProofStep[]>(() => {
    const s: ProofStep[] = []
    if (requirements.requireLike || requirements.requireRepost)
      s.push({ kind: "track" })
    for (const target of requirements.followTargets)
      s.push({ kind: "follow", target })
    return s
  }, [requirements])

  const hasProofs = proofSteps.length > 0

  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [batchFiles, setBatchFiles] = useState<File[]>([])
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [outcome, setOutcome] = useState<
    null | "verifying" | "approved" | "rejected" | "needs_review"
  >(null)

  useEffect(() => {
    if (outcome === "approved") fireDownloadConversion(tracking)
  }, [outcome, tracking])

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return
    const valid: File[] = []
    for (const f of Array.from(list)) {
      const err = fileError(f)
      if (err) {
        setError(err)
        continue
      }
      valid.push(f)
    }
    if (valid.length) {
      setError(null)
      setBatchFiles((prev) => [...prev, ...valid].slice(0, MAX_BATCH))
    }
  }, [])

  const removeFile = (i: number) =>
    setBatchFiles((prev) => prev.filter((_, j) => j !== i))

  useEffect(() => {
    if (outcome || !hasProofs) return
    const hasFile = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files")
    const onOver = (e: DragEvent) => {
      if (hasFile(e)) {
        e.preventDefault()
        setDragging(true)
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFile(e)) return
      e.preventDefault()
      setDragging(false)
      addFiles(e.dataTransfer?.files ?? null)
    }
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    window.addEventListener("dragover", onOver)
    window.addEventListener("drop", onDrop)
    window.addEventListener("dragleave", onLeave)
    return () => {
      window.removeEventListener("dragover", onOver)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("dragleave", onLeave)
    }
  }, [outcome, hasProofs, addFiles])

  const ensureSubmission = async (): Promise<Submission | null> => {
    if (submission) return submission
    if (requirements.emailEnabled) {
      if (!email.trim()) {
        setError("Enter your email to continue.")
        return null
      }
      if (!consent) {
        setError("Please accept to join the artist's list.")
        return null
      }
    }
    const result = await startSubmissionAction({
      gateId,
      email: requirements.emailEnabled ? email.trim() : null,
      consent,
    })
    if (!result.ok) {
      setError(result.error)
      return null
    }
    const sub = {
      submissionId: result.submissionId,
      statusToken: result.statusToken,
      proofCode: result.proofCode,
    }
    setSubmission(sub)
    if (result.approved) setOutcome("approved")
    return sub
  }

  const pollStatus = async (statusToken: string) => {
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const { status } = await getSubmissionStatusAction(statusToken)
      if (status === "approved") return setOutcome("approved")
      if (status === "rejected") return setOutcome("rejected")
      if (status === "needs_review") return setOutcome("needs_review")
    }
    setOutcome("needs_review")
  }

  const openProfile = (url: string) =>
    window.open(
      url,
      "vividdit-action",
      window.innerWidth > 900 ? "width=1100,height=850,noopener" : "noopener"
    )

  const handleTrackOpen = async () => {
    if (requirements.requireProofCode && !submission) {
      setBusy(true)
      try {
        const sub = await ensureSubmission()
        if (!sub) return
        openProfile(track.soundcloudUrl)
      } finally {
        setBusy(false)
      }
    } else {
      openProfile(track.soundcloudUrl)
    }
  }

  const handleUnlock = async () => {
    setError(null)
    if (requirements.emailEnabled) {
      if (!email.trim()) return setError("Enter your email.")
      if (!consent) return setError("Please accept to join the artist's list.")
    }
    if (hasProofs && batchFiles.length === 0) {
      return setError("Add a screenshot for each step above.")
    }

    setBusy(true)
    try {
      const sub = await ensureSubmission()
      if (!sub) return
      if (!hasProofs) return

      const form = new FormData()
      form.set("statusToken", sub.statusToken)
      form.set("finalize", "false")
      for (const f of batchFiles) form.append("proofs", f)
      const res = await fetch(`/api/submissions/${sub.submissionId}/proofs`, {
        method: "POST",
        body: form,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Upload failed. Try again.")
        return
      }

      await finalizeSubmissionAction(sub.statusToken)
      setOutcome("verifying")
      pollStatus(sub.statusToken)
    } finally {
      setBusy(false)
    }
  }

  // ---- terminal states ----
  if (outcome === "verifying") {
    return (
      <Card>
        <CardContent className="space-y-1 py-5 text-center">
          <h2 className="font-semibold">Checking your proof…</h2>
          <p className="text-sm text-muted-foreground">
            Usually under a minute — hang tight.
          </p>
        </CardContent>
      </Card>
    )
  }
  if (outcome === "approved" && submission) {
    return (
      <Card>
        <CardContent className="space-y-2 py-5 text-center">
          <h2 className="font-semibold">You&apos;re in! 🎉</h2>
          <Button
            render={<a href={`/download/by-status/${submission.statusToken}`} />}
            nativeButton={false}
            className="w-full"
            style={{ backgroundColor: accent }}
          >
            Download the HQ file
          </Button>
        </CardContent>
      </Card>
    )
  }
  if ((outcome === "rejected" || outcome === "needs_review") && submission) {
    return (
      <Card>
        <CardContent className="space-y-2 py-5 text-center">
          <h2 className="font-semibold">
            {outcome === "rejected" ? "Couldn't verify yet" : "Almost there"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {outcome === "rejected"
              ? "We couldn't confirm your proof. Open your status page to resubmit."
              : "We're taking a closer look. Check your status page for the outcome."}
          </p>
          <Button
            render={<a href={`/s/${submission.statusToken}`} />}
            nativeButton={false}
            variant="outline"
            className="w-full"
          >
            Go to status page
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ---- compact single-box checklist ----
  let n = 0
  const OpenBtn = ({ onClick }: { onClick: () => void }) => (
    <Button
      size="sm"
      onClick={onClick}
      disabled={busy}
      className="h-7 shrink-0 px-2 text-xs"
      style={{ backgroundColor: accent }}
    >
      Open ↗
    </Button>
  )

  return (
    <Card className={cn(dragging && "ring-2 ring-offset-2", "transition")}>
      <CardContent className="p-0">
        <div className="px-4 pt-3 pb-2">
          <h2 className="text-base font-semibold">Unlock the download</h2>
        </div>

        {error && (
          <div className="px-4 pb-2">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="divide-y border-y">
          {requirements.emailEnabled && (
            <Row n={++n} done={!!email.trim() && consent} accent={accent}>
              <p className="text-sm font-medium">
                Join {track.artistName}&apos;s email list
              </p>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1.5 h-9"
              />
              <label className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-tight text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 size-3.5"
                />
                Join {track.artistName}&apos;s list &amp; get updates.
                Unsubscribe anytime.
              </label>
            </Row>
          )}

          {proofSteps.map((s) => {
            if (s.kind === "track") {
              return (
                <Row key="track" n={++n} accent={accent}>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm font-medium">
                      Like / Repost on SoundCloud
                    </p>
                    <OpenBtn onClick={handleTrackOpen} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      requirements.requireLike && "♥ Like",
                      requirements.requireRepost && "⟳ Repost",
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    the track, then screenshot it.
                  </p>
                  {requirements.requireProofCode &&
                    (submission ? (
                      <div className="mt-1.5 flex items-center gap-2 rounded-md border px-2 py-1">
                        <code className="text-sm font-semibold tracking-wider">
                          {submission.proofCode}
                        </code>
                        <span className="text-[11px] text-muted-foreground">
                          paste in a comment
                        </span>
                        <button
                          type="button"
                          className="ml-auto text-xs underline"
                          onClick={() =>
                            navigator.clipboard.writeText(submission.proofCode)
                          }
                        >
                          Copy
                        </button>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Tap “Open ↗” to get your proof code.
                      </p>
                    ))}
                </Row>
              )
            }
            return (
              <Row key={s.target.id} n={++n} accent={accent}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium">
                    Follow {s.target.displayName} on{" "}
                    {PLATFORM_LABEL[s.target.platform]}
                  </p>
                  <OpenBtn onClick={() => openProfile(s.target.profileUrl)} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tap <strong>Follow</strong>, then screenshot “Following”.
                </p>
              </Row>
            )
          })}

          {hasProofs && (
            <div className="px-4 py-2.5">
              <p className="text-sm font-medium">
                Upload your screenshots{" "}
                <span className="font-normal text-muted-foreground">
                  ({proofSteps.length})
                </span>
              </p>
              <BatchDrop
                files={batchFiles}
                dragging={dragging}
                onAdd={addFiles}
                onRemove={removeFile}
              />
            </div>
          )}
        </div>

        <div className="p-4">
          <Button
            onClick={handleUnlock}
            disabled={busy}
            className="w-full"
            style={{ backgroundColor: accent }}
          >
            {busy
              ? "Working…"
              : hasProofs
                ? "Unlock the download"
                : "Get the download"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Row({
  n,
  done,
  accent,
  children,
}: {
  n: number
  done?: boolean
  accent: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: done ? accent : "#a1a1aa" }}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function BatchDrop({
  files,
  dragging,
  onAdd,
  onRemove,
}: {
  files: File[]
  dragging: boolean
  onAdd: (list: FileList | File[] | null) => void
  onRemove: (i: number) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div className="mt-1.5 space-y-1.5">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }}
        onDragLeave={(e) => {
          e.stopPropagation()
          setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          onAdd(e.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer items-center justify-center gap-1 rounded-md border-2 border-dashed px-3 py-2.5 text-center text-xs transition-colors",
          over || dragging
            ? "border-primary bg-muted"
            : "border-input hover:bg-muted/50"
        )}
      >
        <span className="font-medium">Drop screenshots here</span>
        <span className="text-muted-foreground">or tap to choose</span>
        <input
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => onAdd(e.target.files)}
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1 text-xs">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded border px-2 py-0.5"
            >
              <span className="truncate">✓ {f.name}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ml-auto text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
