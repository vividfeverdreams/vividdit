"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import {
  finalizeSubmissionAction,
  getSubmissionStatusAction,
  startSubmissionAction,
} from "@/app/[artistSlug]/[gateSlug]/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fireDownloadConversion, type GateTracking } from "@/lib/tracking"
import { cn } from "@/lib/utils"

const MAX_BYTES = 10 * 1024 * 1024
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

type ProofStep =
  | { key: "track"; kind: "track" }
  | { key: string; kind: "follow"; target: FollowTarget }

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
      s.push({ key: "track", kind: "track" })
    for (const target of requirements.followTargets)
      s.push({ key: `follow:${target.id}`, kind: "follow", target })
    return s
  }, [requirements])

  const hasProofs = proofSteps.length > 0

  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [outcome, setOutcome] = useState<
    null | "verifying" | "approved" | "rejected" | "needs_review"
  >(null)

  // Mirror of files for the window-level drop handler (avoids stale closures).
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => {
    if (outcome === "approved") fireDownloadConversion(tracking)
  }, [outcome, tracking])

  const setStepFile = (key: string, file: File | null) => {
    if (file) {
      const err = fileError(file)
      if (err) return setError(err)
    }
    setError(null)
    setFiles((prev) => ({ ...prev, [key]: file }))
  }

  // Drop anywhere on the page → attach to the first step still missing a shot.
  const assignToNextEmpty = (file: File) => {
    const err = fileError(file)
    if (err) return setError(err)
    const cur = filesRef.current
    const target =
      proofSteps.find((s) => !cur[s.key]) ?? proofSteps[proofSteps.length - 1]
    if (!target) return
    setError(null)
    setFiles((prev) => ({ ...prev, [target.key]: file }))
  }

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
      const f = e.dataTransfer?.files?.[0]
      if (f) assignToNextEmpty(f)
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
    // assignToNextEmpty reads current files via filesRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, hasProofs, proofSteps])

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

  // Proof-code gates: the code lives on the submission, so create it (which
  // needs email when required) the moment the fan opens the SoundCloud track.
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
    for (const s of proofSteps) {
      if (!files[s.key]) {
        const label =
          s.kind === "track" ? "the SoundCloud track" : s.target.displayName
        return setError(`Add a screenshot for: ${label}.`)
      }
    }

    setBusy(true)
    try {
      const sub = await ensureSubmission()
      if (!sub) return
      if (!hasProofs) return // email-only → approved via ensureSubmission

      for (const s of proofSteps) {
        const file = files[s.key]!
        const platform = s.kind === "track" ? "soundcloud" : s.target.platform
        const followTargetId = s.kind === "track" ? null : s.target.id
        const form = new FormData()
        form.set("statusToken", sub.statusToken)
        form.set("platform", platform)
        form.set("finalize", "false")
        if (followTargetId) form.set("followTargetId", followTargetId)
        form.append("proofs", file)
        const res = await fetch(
          `/api/submissions/${sub.submissionId}/proofs`,
          { method: "POST", body: form }
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error ?? "Upload failed. Try again.")
          return
        }
      }

      await finalizeSubmissionAction(sub.statusToken)
      setOutcome("verifying")
      pollStatus(sub.statusToken)
    } finally {
      setBusy(false)
    }
  }

  const totalSteps = (requirements.emailEnabled ? 1 : 0) + proofSteps.length
  const doneSteps =
    (requirements.emailEnabled && email.trim() && consent ? 1 : 0) +
    proofSteps.filter((s) => files[s.key]).length

  // ---- terminal states ----
  if (outcome === "verifying") {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6 text-center">
          <h2 className="text-lg font-semibold">Checking your proof…</h2>
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
        <CardContent className="space-y-3 pt-6 text-center">
          <h2 className="text-lg font-semibold">You&apos;re in! 🎉</h2>
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
        <CardContent className="space-y-3 pt-6 text-center">
          <h2 className="text-lg font-semibold">
            {outcome === "rejected" ? "Couldn't verify yet" : "Almost there"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {outcome === "rejected"
              ? "We couldn't confirm your proof. Open your status page to see why and resubmit."
              : "We're giving your proof a closer look. Check your status page for the outcome."}
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

  // ---- checklist ----
  let n = 0
  return (
    <Card className={cn(dragging && "ring-2 ring-offset-2", "transition")}>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-lg font-semibold">Unlock the download</h2>
          <p className="text-sm text-muted-foreground">
            {totalSteps > 1
              ? `Complete ${totalSteps} quick steps — ${doneSteps}/${totalSteps} done`
              : "One quick step to unlock"}
          </p>
        </div>

        {dragging && hasProofs && (
          <div className="rounded-lg border border-dashed border-primary bg-muted/50 p-2 text-center text-xs font-medium">
            📎 Drop your screenshot — it&apos;ll attach to the next open step
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {requirements.emailEnabled && (
          <ChecklistRow
            n={++n}
            title={`Join ${track.artistName}'s email list`}
            done={!!email.trim() && consent}
            accent={accent}
          >
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
              updates. Unsubscribe anytime.
            </label>
          </ChecklistRow>
        )}

        {proofSteps.map((s) => {
          if (s.kind === "track") {
            return (
              <ChecklistRow
                key={s.key}
                n={++n}
                title="Like / Repost on SoundCloud"
                done={!!files[s.key]}
                accent={accent}
              >
                <Button
                  onClick={handleTrackOpen}
                  disabled={busy}
                  className="w-full"
                  style={{ backgroundColor: accent }}
                >
                  Open the track on SoundCloud ↗
                </Button>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {requirements.requireLike && <li>♥ Tap Like (the heart)</li>}
                  {requirements.requireRepost && <li>⟳ Tap Repost</li>}
                </ul>
                {requirements.requireProofCode &&
                  (submission ? (
                    <div className="flex items-center gap-2 rounded-lg border p-3">
                      <code className="text-lg font-semibold tracking-wider">
                        {submission.proofCode}
                      </code>
                      <span className="text-xs text-muted-foreground">
                        paste into the comment box
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={() =>
                          navigator.clipboard.writeText(submission.proofCode)
                        }
                      >
                        Copy
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Tap “Open the track” to get your unique proof code.
                    </p>
                  ))}
                <ProofDrop file={files[s.key]} onPick={(f) => setStepFile(s.key, f)} />
              </ChecklistRow>
            )
          }
          return (
            <ChecklistRow
              key={s.key}
              n={++n}
              title={`Follow ${s.target.displayName} on ${PLATFORM_LABEL[s.target.platform]}`}
              done={!!files[s.key]}
              accent={accent}
            >
              <Button
                onClick={() => openProfile(s.target.profileUrl)}
                className="w-full"
                style={{ backgroundColor: accent }}
              >
                Open {PLATFORM_LABEL[s.target.platform]} ↗
              </Button>
              <p className="text-sm text-muted-foreground">
                Tap <strong>Follow</strong>, then screenshot the profile showing
                “Following”.
              </p>
              <ProofDrop file={files[s.key]} onPick={(f) => setStepFile(s.key, f)} />
            </ChecklistRow>
          )
        })}

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
      </CardContent>
    </Card>
  )
}

function ChecklistRow({
  n,
  title,
  done,
  accent,
  children,
}: {
  n: number
  title: string
  done: boolean
  accent: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: done ? accent : "#a1a1aa" }}
        >
          {done ? "✓" : n}
        </span>
        <h3 className="font-medium">{title}</h3>
      </div>
      <div className="space-y-3 pl-9">{children}</div>
    </div>
  )
}

function ProofDrop({
  file,
  onPick,
}: {
  file: File | null
  onPick: (f: File | null) => void
}) {
  const [over, setOver] = useState(false)
  return (
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
        const f = e.dataTransfer.files?.[0]
        if (f) onPick(f)
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors",
        over
          ? "border-primary bg-muted"
          : file
            ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
            : "border-input hover:bg-muted/50"
      )}
    >
      {file ? (
        <span className="font-medium">✓ {file.name} — tap to replace</span>
      ) : (
        <>
          <span className="font-medium">Drop your screenshot here</span>
          <span className="text-muted-foreground">or tap to choose</span>
        </>
      )}
      <input
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  )
}
