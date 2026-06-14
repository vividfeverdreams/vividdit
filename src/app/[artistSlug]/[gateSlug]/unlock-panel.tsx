"use client"

import { useEffect, useMemo, useState } from "react"

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
import { Progress } from "@/components/ui/progress"
import { fireDownloadConversion, type GateTracking } from "@/lib/tracking"

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

type Step =
  | { kind: "email" }
  | { kind: "track" }
  | { kind: "follow"; target: FollowTarget }

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
  const steps = useMemo<Step[]>(() => {
    const s: Step[] = []
    if (requirements.emailEnabled) s.push({ kind: "email" })
    if (requirements.requireLike || requirements.requireRepost)
      s.push({ kind: "track" })
    for (const target of requirements.followTargets)
      s.push({ kind: "follow", target })
    return s
  }, [requirements])

  const [stepIndex, setStepIndex] = useState(0)
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<
    null | "verifying" | "approved" | "rejected" | "needs_review"
  >(null)

  const done = stepIndex >= steps.length
  const progress = outcome ? 100 : Math.round((stepIndex / steps.length) * 100)

  useEffect(() => {
    if (outcome === "approved") fireDownloadConversion(tracking)
  }, [outcome, tracking])

  const ensureSubmission = async (): Promise<Submission | null> => {
    if (submission) return submission
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
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const { status } = await getSubmissionStatusAction(statusToken)
      if (status === "approved") return setOutcome("approved")
      if (status === "rejected") return setOutcome("rejected")
      if (status === "needs_review") return setOutcome("needs_review")
    }
    setOutcome("needs_review")
  }

  const uploadProof = async (
    sub: Submission,
    platform: string,
    followTargetId: string | null,
    isLast: boolean
  ) => {
    const form = new FormData()
    form.set("statusToken", sub.statusToken)
    form.set("platform", platform)
    form.set("finalize", "false")
    if (followTargetId) form.set("followTargetId", followTargetId)
    form.append("proofs", file!)
    const res = await fetch(`/api/submissions/${sub.submissionId}/proofs`, {
      method: "POST",
      body: form,
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? "Upload failed. Try again.")
      return false
    }
    if (isLast) {
      await finalizeSubmissionAction(sub.statusToken)
      setOutcome("verifying")
      pollStatus(sub.statusToken)
    }
    return true
  }

  const advance = () => {
    setFile(null)
    setError(null)
    setStepIndex((i) => i + 1)
  }

  const handleEmailStep = async () => {
    setError(null)
    if (requirements.emailEnabled) {
      if (!email.trim()) return setError("Enter your email to continue.")
      if (!consent) return setError("Please accept to join the artist's list.")
    }
    setBusy(true)
    try {
      const sub = await ensureSubmission()
      if (!sub) return
      if (steps.length === 1) return // email-only → approved
      advance()
    } finally {
      setBusy(false)
    }
  }

  const handleProofStep = async (
    platform: string,
    followTargetId: string | null
  ) => {
    setError(null)
    if (!file) return setError("Upload a screenshot to continue.")
    if (!ALLOWED_TYPES.includes(file.type))
      return setError("Screenshot must be JPG, PNG, or WEBP.")
    if (file.size > MAX_BYTES) return setError("Screenshot is over 10MB.")

    setBusy(true)
    try {
      const sub = await ensureSubmission()
      if (!sub) return
      const isLast = stepIndex === steps.length - 1
      if (await uploadProof(sub, platform, followTargetId, isLast)) advance()
    } finally {
      setBusy(false)
    }
  }

  const openProfile = (url: string) => {
    window.open(
      url,
      "vividdit-follow",
      window.innerWidth > 900 ? "width=1100,height=850,noopener" : "noopener"
    )
  }

  const current = steps[stepIndex]

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground">
            {outcome
              ? outcome === "verifying"
                ? "Verifying…"
                : "Complete"
              : `Step ${Math.min(stepIndex + 1, steps.length)} of ${steps.length}`}
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {outcome === "verifying" && (
          <div className="space-y-2 text-center">
            <h2 className="text-lg font-semibold">Checking your proof…</h2>
            <p className="text-sm text-muted-foreground">
              Usually under a minute — hang tight.
            </p>
          </div>
        )}

        {outcome === "approved" && submission && (
          <div className="space-y-3 text-center">
            <h2 className="text-lg font-semibold">You&apos;re in! 🎉</h2>
            <Button
              render={<a href={`/download/by-status/${submission.statusToken}`} />}
              nativeButton={false}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              Download the HQ file
            </Button>
          </div>
        )}

        {(outcome === "rejected" || outcome === "needs_review") && submission && (
          <div className="space-y-3 text-center">
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
          </div>
        )}

        {!outcome && !done && current?.kind === "email" && (
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">Join {track.artistName}&apos;s email list</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email to start unlocking the download.
              </p>
            </div>
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
            <Button
              onClick={handleEmailStep}
              disabled={busy}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              {busy ? "…" : steps.length === 1 ? "Get the download" : "Continue"}
            </Button>
          </div>
        )}

        {!outcome && !done && current?.kind === "track" && (
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">On SoundCloud</h2>
              <Button
                onClick={() => openProfile(track.soundcloudUrl)}
                className="mt-2 w-full"
                style={{ backgroundColor: accent }}
              >
                Open the track on SoundCloud ↗
              </Button>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {requirements.requireLike && <li>♥ Tap Like (the heart)</li>}
                {requirements.requireRepost && <li>⟳ Tap Repost</li>}
              </ul>
            </div>
            {requirements.requireProofCode && submission && (
              <div className="flex items-center gap-2 rounded-lg border p-3">
                <code className="text-lg font-semibold tracking-wider">
                  {submission.proofCode}
                </code>
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
            )}
            <ProofUpload
              label="Screenshot the track page showing the actions done"
              hint={
                requirements.requireProofCode
                  ? "Tip: paste your code into the comment box (no need to post) so it's visible."
                  : undefined
              }
              onPick={setFile}
              file={file}
            />
            <Button
              onClick={() => handleProofStep("soundcloud", null)}
              disabled={busy || !file}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              {busy ? "Uploading…" : "Continue"}
            </Button>
          </div>
        )}

        {!outcome && !done && current?.kind === "follow" && (
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">
                Follow {current.target.displayName} on{" "}
                {PLATFORM_LABEL[current.target.platform]}
              </h2>
              <Button
                onClick={() => openProfile(current.target.profileUrl)}
                className="mt-2 w-full"
                style={{ backgroundColor: accent }}
              >
                Open {PLATFORM_LABEL[current.target.platform]} ↗
              </Button>
              <p className="mt-2 text-sm text-muted-foreground">
                Tap <strong>Follow</strong>, then screenshot the profile showing
                “Following”.
              </p>
            </div>
            <ProofUpload
              label={`Screenshot showing you follow ${current.target.displayName}`}
              onPick={setFile}
              file={file}
            />
            <Button
              onClick={() =>
                handleProofStep(current.target.platform, current.target.id)
              }
              disabled={busy || !file}
              className="w-full"
              style={{ backgroundColor: accent }}
            >
              {busy ? "Uploading…" : "Continue"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProofUpload({
  label,
  hint,
  file,
  onPick,
}: {
  label: string
  hint?: string
  file: File | null
  onPick: (f: File | null) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {file && <p className="text-xs text-muted-foreground">✓ {file.name}</p>}
    </div>
  )
}
