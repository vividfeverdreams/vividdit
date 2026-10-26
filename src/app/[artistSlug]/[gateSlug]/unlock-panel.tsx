"use client"

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  getSubmissionStatusAction,
  quickUnlockAction,
  startSubmissionAction,
  verifiedUnlockAction,
} from "@/app/[artistSlug]/[gateSlug]/actions"
import {
  InstagramIcon,
  SoundCloudIcon,
  SpotifyIcon,
} from "@/components/brand-icons"
import type { GateTheme } from "@/lib/colors"
import { appLink, type Platform } from "@/lib/deep-links"
import { sendGateEvent } from "@/lib/gate-beacon"
import { ALLOWED_PROOF_TYPES, proofFileError } from "@/lib/proof-upload-contract"
import {
  ProofUploadClientError,
  uploadProofFiles,
} from "@/lib/proof-upload-client"
import { fireDownloadConversion, type GateTracking } from "@/lib/tracking"
import { getVisitorId } from "@/lib/visitor-id"
import { cn } from "@/lib/utils"

const PLATFORM_LABEL: Record<Platform, string> = {
  soundcloud: "SoundCloud",
  instagram: "Instagram",
  spotify: "Spotify",
}

const PLATFORM_ICON: Record<Platform, typeof InstagramIcon> = {
  soundcloud: SoundCloudIcon,
  instagram: InstagramIcon,
  spotify: SpotifyIcon,
}

// Brand marks keep their own colors so fans recognise them at a glance.
const PLATFORM_COLOR: Record<Platform, string> = {
  soundcloud: "#ff5500",
  instagram: "#e4405f",
  spotify: "#1db954",
}

// A fan who comes back faster than this probably never reached the app.
const RETURN_GRACE_MS = 1500
const SAVE_TTL_MS = 7 * 24 * 3600 * 1000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Event-time clock, kept out of the component body for the purity lint.
const now = () => Date.now()

export type FollowTarget = {
  id: string
  platform: Platform
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

export type DownloadFile = { format: string; name: string; size: string | null }
export type VaultOffer = { url: string; count: number }

type Action = {
  key: string
  platform: Platform
  title: string
  url: string
  followTargetId: string | null
  done: string
}

// Everything a fan has done so far, kept in the browser so leaving for
// Instagram (and a phone reloading the tab on return) can't wipe it.
type Progress = {
  email: string
  submissionId: string | null
  statusToken: string | null
  proofCode: string | null
  done: string[]
  uploads: Record<string, string[]>
  pending: { key: string; at: number } | null
  unlocked: boolean
  emailed: boolean
  savedAt: number
}

const EMPTY: Progress = {
  email: "",
  submissionId: null,
  statusToken: null,
  proofCode: null,
  done: [],
  uploads: {},
  pending: null,
  unlocked: false,
  emailed: false,
  savedAt: 0,
}

function storageKey(gateId: string) {
  return `vividdit:gate:${gateId}`
}

function hideStyleId(gateId: string) {
  return `vividdit-restoring-${gateId}`
}

function loadProgress(gateId: string): Progress | null {
  try {
    const raw = localStorage.getItem(storageKey(gateId))
    if (!raw) return null
    const saved = { ...EMPTY, ...(JSON.parse(raw) as Partial<Progress>) }
    if (Date.now() - saved.savedAt > SAVE_TTL_MS) return null
    return saved
  } catch {
    return null
  }
}

function saveProgress(gateId: string, progress: Progress) {
  try {
    localStorage.setItem(
      storageKey(gateId),
      JSON.stringify({ ...progress, savedAt: Date.now() })
    )
  } catch {
    // Storage blocked: progress lives for this page only.
  }
}

export function UnlockPanel({
  gateId,
  theme,
  unlockMode,
  requirements,
  track,
  tracking,
  isVault = false,
  file,
  vaultOffer,
}: {
  gateId: string
  theme: GateTheme
  unlockMode: "quick" | "verified"
  requirements: Requirements
  track: Track
  tracking: GateTracking
  isVault?: boolean
  file: DownloadFile | null
  vaultOffer: VaultOffer | null
}) {
  const verified = unlockMode === "verified"

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = []
    const { requireLike, requireRepost } = requirements
    if (requireLike || requireRepost) {
      list.push({
        key: "track",
        platform: "soundcloud",
        title:
          requireLike && requireRepost
            ? "Like + repost the track"
            : requireLike
              ? "Like the track"
              : "Repost the track",
        url: track.soundcloudUrl,
        followTargetId: null,
        done: "Already done",
      })
    }
    for (const t of requirements.followTargets) {
      list.push({
        key: t.id,
        platform: t.platform,
        title: `Follow ${t.displayName}`,
        url: t.profileUrl,
        followTargetId: t.id,
        done: "I already follow",
      })
    }
    return list
  }, [requirements, track.soundcloudUrl])

  const [progress, setProgress] = useState<Progress>(EMPTY)
  const [emailInput, setEmailInput] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [opened, setOpened] = useState<string[]>([])
  const [userAgent, setUserAgent] = useState("")
  const [copied, setCopied] = useState(false)

  const progressRef = useRef(progress)
  const startRef = useRef<Promise<string | null> | null>(null)
  const unlockingRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restoredRef = useRef(false)

  const update = useCallback(
    (patch: Partial<Progress>) => {
      const next = { ...progressRef.current, ...patch }
      progressRef.current = next
      setProgress(next)
      saveProgress(gateId, next)
    },
    [gateId]
  )

  const screens = useMemo(() => {
    const s: ("email" | "actions" | "done")[] = []
    if (requirements.emailEnabled) s.push("email")
    if (actions.length > 0) s.push("actions")
    s.push("done")
    return s
  }, [requirements.emailEnabled, actions.length])

  const screen: "email" | "actions" | "done" = progress.unlocked
    ? "done"
    : requirements.emailEnabled && !progress.statusToken
      ? "email"
      : actions.length > 0
        ? "actions"
        : "email"
  const stepNumber = screens.indexOf(screen) + 1

  // Restore saved progress, log the visit, and re-check the saved submission.
  useEffect(() => {
    // Browser-only state can only be read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserAgent(navigator.userAgent)
    const saved = loadProgress(gateId)
    if (saved) {
      // A tap that left for an app and never got its "came back" event (the
      // phone reloaded the tab instead) still counts as done.
      if (saved.pending && Date.now() - saved.pending.at > RETURN_GRACE_MS) {
        const key = saved.pending.key
        saved.pending = null
        if (verified) setOpened((o) => [...o, key])
        else if (!saved.done.includes(key)) saved.done = [...saved.done, key]
      }
      progressRef.current = saved
      setProgress(saved)
      setEmailInput(saved.email)
    }
    restoredRef.current = true
    document.getElementById(hideStyleId(gateId))?.remove()
    sendGateEvent({ gateId, type: "view", statusToken: saved?.statusToken })

    if (saved?.statusToken) {
      getSubmissionStatusAction(saved.statusToken)
        .then(({ status, unlocked }) => {
          if (status === null) {
            update({ ...EMPTY, email: saved.email })
          } else if (unlocked) {
            update({ unlocked: true })
          } else if (status === "rejected") {
            update({ unlocked: false, done: [], uploads: {} })
            setError(
              "Your screenshots didn't pass the check. Add clearer ones for each step."
            )
          }
        })
        .catch(() => {})
    }
  }, [gateId, update, verified])

  // Move focus to each new step's heading so screen readers follow along.
  const lastScreen = useRef(screen)
  useEffect(() => {
    if (lastScreen.current !== screen && restoredRef.current) {
      headingRef.current?.focus()
    }
    lastScreen.current = screen
  }, [screen])

  const markDone = useCallback(
    (key: string) => {
      const p = progressRef.current
      if (p.done.includes(key)) return
      update({ done: [...p.done, key], pending: null })
    },
    [update]
  )

  // "Ticked when you came back": a fan who left for an app and returned has
  // done that step.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return
      const pending = progressRef.current.pending
      if (!pending) return
      if (Date.now() - pending.at < RETURN_GRACE_MS) return
      if (verified) {
        update({ pending: null })
        setOpened((o) => (o.includes(pending.key) ? o : [...o, pending.key]))
      } else {
        markDone(pending.key)
      }
    }
    // pageshow covers Back from the web page (restored from the page cache).
    document.addEventListener("visibilitychange", onReturn)
    window.addEventListener("focus", onReturn)
    window.addEventListener("pageshow", onReturn)
    return () => {
      document.removeEventListener("visibilitychange", onReturn)
      window.removeEventListener("focus", onReturn)
      window.removeEventListener("pageshow", onReturn)
    }
  }, [markDone, update, verified])

  const ensureSubmission = useCallback(async (): Promise<string | null> => {
    const existing = progressRef.current.statusToken
    if (existing) return existing
    if (!startRef.current) {
      startRef.current = (async () => {
        const result = await startSubmissionAction({
          gateId,
          email: requirements.emailEnabled ? progressRef.current.email : null,
          consent: requirements.emailEnabled,
          visitorId: getVisitorId(),
        })
        if (!result.ok) {
          setError(result.error)
          return null
        }
        update({
          submissionId: result.submissionId,
          statusToken: result.statusToken,
          proofCode: result.proofCode,
          ...(result.approved ? { unlocked: true, emailed: result.emailed } : {}),
        })
        return result.statusToken
      })().finally(() => {
        startRef.current = null
      })
    }
    return startRef.current
  }, [gateId, requirements.emailEnabled, update])

  const fireConversion = useCallback(() => {
    fireDownloadConversion(tracking)
  }, [tracking])

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = emailInput.trim()
    if (!EMAIL.test(email)) {
      setEmailError("Enter a valid email, like you@gmail.com.")
      return
    }
    setEmailError(null)
    setError(null)
    setBusy(true)
    try {
      update({ email })
      const token = await ensureSubmission()
      if (token && progressRef.current.unlocked) fireConversion()
    } catch {
      setError("Something went wrong. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const unlock = useCallback(async () => {
    if (unlockingRef.current) return
    unlockingRef.current = true
    setError(null)
    setBusy(true)
    try {
      const token = await ensureSubmission()
      if (!token) return
      if (progressRef.current.unlocked) {
        fireConversion()
        return
      }
      const result = verified
        ? await verifiedUnlockAction({ statusToken: token })
        : await quickUnlockAction({
            statusToken: token,
            completedSteps: progressRef.current.done,
          })
      if (!result.ok) {
        setError(result.error)
        return
      }
      update({ unlocked: true, emailed: result.emailed })
      fireConversion()
    } catch {
      setError("Something went wrong. Check your connection and try again.")
    } finally {
      unlockingRef.current = false
      setBusy(false)
    }
  }, [ensureSubmission, fireConversion, update, verified])

  const allDone = actions.every((a) =>
    verified
      ? (progress.uploads[a.key]?.length ?? 0) > 0
      : progress.done.includes(a.key)
  )

  // Verified gates need the fan's record before the first app switch (for the
  // proof code and the uploads). Quick gates without an email step create it
  // at unlock instead: a tap that navigates away could drop the response.
  useEffect(() => {
    if (verified && screen === "actions" && !progress.statusToken && restoredRef.current) {
      void ensureSubmission()
    }
  }, [ensureSubmission, progress.statusToken, screen, verified])

  // Quick unlock finishes itself once the last follow is ticked off.
  useEffect(() => {
    if (
      !verified &&
      screen === "actions" &&
      allDone &&
      !progress.unlocked &&
      !error &&
      restoredRef.current
    ) {
      void unlock()
    }
  }, [allDone, error, progress.unlocked, screen, unlock, verified])

  const onOpen = (action: Action) => {
    setError(null)
    update({ pending: { key: action.key, at: now() } })
    sendGateEvent({
      gateId,
      type: "open",
      step: action.key,
      statusToken: progressRef.current.statusToken,
    })
  }

  const onAlready = (action: Action) => {
    setError(null)
    sendGateEvent({
      gateId,
      type: "open",
      step: action.key,
      statusToken: progressRef.current.statusToken,
    })
    if (verified) setOpened((o) => (o.includes(action.key) ? o : [...o, action.key]))
    else markDone(action.key)
  }

  const onScreenshot = async (action: Action, list: FileList | null) => {
    const picked = list?.[0]
    if (!picked) return
    const invalid = proofFileError(picked)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setUploading(action.key)
    try {
      const token = await ensureSubmission()
      const submissionId = progressRef.current.submissionId
      if (!token || !submissionId) return
      await uploadProofFiles({
        submissionId,
        statusToken: token,
        files: [picked],
        step: { platform: action.platform, followTargetId: action.followTargetId },
      })
      const uploads = progressRef.current.uploads
      update({
        uploads: { ...uploads, [action.key]: [...(uploads[action.key] ?? []), picked.name] },
      })
    } catch (err) {
      setError(
        err instanceof ProofUploadClientError
          ? err.message
          : "Upload failed. Check your connection and try again."
      )
    } finally {
      setUploading(null)
    }
  }

  const vars = {
    "--g-fg": theme.fg,
    "--g-card": theme.card,
    "--g-line": theme.line,
    "--g-muted": theme.muted,
    "--g-subtle": theme.subtle,
    "--g-accent": theme.accent,
    "--g-accent-fg": theme.accentFg,
    "--g-danger": theme.danger,
  } as React.CSSProperties

  const primary =
    "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--g-accent)] px-4 text-base font-semibold text-[var(--g-accent-fg)] transition-[transform,opacity] outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--g-card)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
  const secondary =
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-[var(--g-muted)] outline-none hover:text-[var(--g-fg)] focus-visible:ring-2 focus-visible:ring-[var(--g-accent)]"

  const remaining = actions.filter((a) =>
    verified
      ? (progress.uploads[a.key]?.length ?? 0) === 0
      : !progress.done.includes(a.key)
  ).length

  return (
    <section
      aria-label="Unlock the download"
      data-gate={gateId}
      style={vars}
      className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-4 text-[var(--g-fg)] shadow-sm sm:p-5"
    >
      {/* A first-time fan sees the email step straight from the server HTML.
          Only a fan with saved progress gets the steps hidden until the page
          restores it, so their real step doesn't flash in after the email one. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(localStorage.getItem(${JSON.stringify(storageKey(gateId))})){var s=document.createElement("style");s.id=${JSON.stringify(hideStyleId(gateId))};s.textContent=${JSON.stringify(`[data-gate="${gateId}"] [aria-live]{visibility:hidden}`)};document.head.appendChild(s);setTimeout(function(){s.remove()},4000)}}catch(e){}`,
        }}
      />
      {screens.length > 1 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[13px] text-[var(--g-muted)]">
            <span>
              {screen === "done" ? "Unlocked" : `Step ${stepNumber} of ${screens.length}`}
            </span>
            {screen === "actions" && remaining > 0 && (
              <span>
                {remaining} {remaining === 1 ? "step" : "steps"} left
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1.5" aria-hidden="true">
            {screens.map((s, i) => (
              <span
                key={s}
                className="h-1 flex-1 rounded-full transition-colors motion-reduce:transition-none"
                style={{
                  backgroundColor: i < stepNumber ? theme.accent : theme.line,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div aria-live="polite">
        {screen === "email" && (
          <form onSubmit={submitEmail} noValidate className="space-y-3">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-bold tracking-tight outline-none"
            >
              Where should we send it?
            </h2>
            <div className="space-y-1.5">
              <label htmlFor="fan-email" className="text-sm font-medium">
                Your email
              </label>
              <input
                id="fan-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value)
                  if (emailError) setEmailError(null)
                }}
                placeholder="you@gmail.com"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "fan-email-error" : "fan-email-hint"}
                className={cn(
                  "h-12 w-full rounded-xl border bg-transparent px-3.5 text-base text-[var(--g-fg)] outline-none placeholder:text-[var(--g-muted)] focus-visible:ring-2 focus-visible:ring-[var(--g-accent)]",
                  emailError ? "border-[var(--g-danger)]" : "border-[var(--g-line)]"
                )}
              />
              {emailError ? (
                <p id="fan-email-error" role="alert" className="text-[13px] text-[var(--g-danger)]">
                  {emailError}
                </p>
              ) : (
                <p id="fan-email-hint" className="text-[13px] leading-snug text-[var(--g-muted)]">
                  You&apos;ll join {track.artistName}&apos;s email list. Unsubscribe anytime.
                </p>
              )}
            </div>
            <button type="submit" disabled={busy} className={primary}>
              {busy ? (
                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
              ) : null}
              {busy
                ? "One sec…"
                : actions.length > 0
                  ? "Continue"
                  : "Get the download"}
              {!busy && <ArrowRight className="size-5" aria-hidden="true" />}
            </button>
            {error && <ErrorLine message={error} />}
            {actions.length > 0 && (
              <p className="text-center text-[13px] text-[var(--g-muted)]">
                {actions.length} {actions.length === 1 ? "tap" : "taps"} next
                {verified ? ", with a screenshot each" : " · about 20 seconds"}
              </p>
            )}
          </form>
        )}

        {screen === "actions" && (
          <div className="space-y-3">
            <div>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-bold tracking-tight outline-none"
              >
                {actions.some((a) => a.followTargetId)
                  ? "Follow to unlock"
                  : "Support the track"}
              </h2>
              {requirements.emailEnabled && progress.email && (
                <p className="mt-0.5 text-[13px] text-[var(--g-muted)]">
                  Sending to {progress.email} ·{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      update({ ...EMPTY })
                    }}
                    className="underline underline-offset-2 hover:text-[var(--g-fg)]"
                  >
                    Change
                  </button>
                </p>
              )}
            </div>

            <ul className="space-y-2.5">
              {actions.map((action) => {
                const Icon = PLATFORM_ICON[action.platform]
                const uploads = progress.uploads[action.key] ?? []
                const done = verified ? uploads.length > 0 : progress.done.includes(action.key)
                const showUpload =
                  verified && (opened.includes(action.key) || uploads.length > 0)
                const link = appLink(action.platform, action.url, userAgent)
                return (
                  <li
                    key={action.key}
                    className={cn(
                      "rounded-xl border p-3.5 transition-colors motion-reduce:transition-none",
                      done
                        ? "border-transparent bg-[var(--g-subtle)]"
                        : "border-[var(--g-line)]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--g-subtle)]"
                        style={{ color: PLATFORM_COLOR[action.platform] }}
                      >
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] leading-tight font-semibold">
                          {action.title}
                        </p>
                        <p className="mt-0.5 text-[13px] text-[var(--g-muted)]">
                          {done
                            ? verified
                              ? `Screenshot added${uploads.length > 1 ? ` (${uploads.length})` : ""}`
                              : "Done"
                            : `on ${PLATFORM_LABEL[action.platform]}`}
                        </p>
                      </div>
                      {done && (
                        <span
                          className="grid size-7 shrink-0 place-items-center rounded-full"
                          style={{ backgroundColor: theme.accent, color: theme.accentFg }}
                        >
                          <Check className="size-4" strokeWidth={3} aria-label="Done" />
                        </span>
                      )}
                    </div>

                    {action.key === "track" &&
                      verified &&
                      requirements.requireProofCode &&
                      progress.proofCode &&
                      !done && (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--g-line)] px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-base font-semibold tracking-wider">
                              {progress.proofCode}
                            </p>
                            <p className="text-[13px] text-[var(--g-muted)]">
                              Paste it in a comment so it shows in your screenshot.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard
                                ?.writeText(progress.proofCode ?? "")
                                .then(() => setCopied(true))
                            }}
                            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-[var(--g-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--g-accent)] outline-none"
                          >
                            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      )}

                    {!done && (
                      <div className="mt-3 space-y-1">
                        <a
                          href={link.href}
                          {...(link.newTab
                            ? { target: "_blank", rel: "noopener noreferrer" }
                            : {})}
                          onClick={() => onOpen(action)}
                          className={primary}
                        >
                          Open {PLATFORM_LABEL[action.platform]}
                          <ArrowUpRight className="size-5" aria-hidden="true" />
                        </a>
                        {!showUpload && (
                          <button
                            type="button"
                            onClick={() => onAlready(action)}
                            className={secondary}
                          >
                            {action.done}
                          </button>
                        )}
                      </div>
                    )}

                    {showUpload && (
                      <label
                        className={cn(
                          "relative flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-medium focus-within:ring-2 focus-within:ring-[var(--g-accent)]",
                          uploads.length > 0
                            ? "mt-1 h-11 text-[var(--g-muted)] hover:text-[var(--g-fg)]"
                            : "mt-2 h-12 border border-dashed border-[var(--g-line)] hover:bg-[var(--g-subtle)]",
                          uploading === action.key && "pointer-events-none opacity-60"
                        )}
                      >
                        {uploading === action.key ? (
                          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <ImagePlus className="size-5" aria-hidden="true" />
                        )}
                        {uploading === action.key
                          ? "Uploading…"
                          : uploads.length > 0
                            ? "Add another screenshot"
                            : "Add your screenshot"}
                        <input
                          type="file"
                          accept={ALLOWED_PROOF_TYPES.join(",")}
                          className="sr-only"
                          onChange={(e) => {
                            void onScreenshot(action, e.target.files)
                            e.target.value = ""
                          }}
                        />
                      </label>
                    )}
                  </li>
                )
              })}
            </ul>

            {error && <ErrorLine message={error} />}

            {verified || !allDone || error ? (
              <button
                type="button"
                onClick={() => void unlock()}
                disabled={busy || !allDone || !!uploading}
                className={primary}
              >
                {busy && (
                  <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                )}
                {busy
                  ? "Unlocking…"
                  : allDone
                    ? "Unlock the download"
                    : `Finish ${remaining} more ${remaining === 1 ? "step" : "steps"}`}
              </button>
            ) : (
              <p className="flex h-12 items-center justify-center gap-2 text-sm font-medium">
                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                Unlocking…
              </p>
            )}

            <p className="text-center text-[13px] text-[var(--g-muted)]">
              {verified
                ? "Screenshot each page showing you did it. Your progress is saved if you switch apps."
                : "Your progress is saved if you switch apps."}
            </p>

            {verified && (
              <details className="text-[13px] text-[var(--g-muted)]">
                <summary className="flex min-h-11 cursor-pointer items-center justify-center font-medium">
                  How do I take a screenshot?
                </summary>
                <div className="space-y-1.5 pb-1">
                  <p>
                    <strong>iPhone:</strong> Side button + Volume Up.{" "}
                    <strong>Android:</strong> Power + Volume Down.
                  </p>
                  <p>
                    <strong>Mac:</strong> Shift + ⌘ + 4, then drag.{" "}
                    <strong>Windows:</strong> Win + Shift + S.
                  </p>
                </div>
              </details>
            )}
          </div>
        )}

        {screen === "done" && progress.statusToken && (
          <div className="space-y-4">
            <div className="text-center">
              <span
                className="mx-auto grid size-14 place-items-center rounded-full"
                style={{ backgroundColor: theme.accent, color: theme.accentFg }}
              >
                <Check className="size-7" strokeWidth={3} aria-hidden="true" />
              </span>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="mt-3 text-2xl font-bold tracking-tight outline-none"
              >
                It&apos;s yours.
              </h2>
            </div>

            <div className="space-y-1.5">
              <a
                href={
                  isVault
                    ? `/download/vault/${progress.statusToken}`
                    : `/download/by-status/${progress.statusToken}`
                }
                className={primary}
              >
                <Download className="size-5" aria-hidden="true" />
                {isVault
                  ? "Open the vault"
                  : file
                    ? `Download ${file.format}`
                    : "Download"}
              </a>
              {!isVault && file && (
                <p className="truncate text-center text-[13px] text-[var(--g-muted)]">
                  {file.size ? `${file.size} · ` : ""}
                  {file.name}
                </p>
              )}
            </div>

            {progress.emailed && progress.email && (
              <p className="text-center text-sm text-[var(--g-muted)]">
                We also emailed the link to{" "}
                <span className="text-[var(--g-fg)]">{progress.email}</span>.
              </p>
            )}

            {vaultOffer && (
              <a
                href={vaultOffer.url}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--g-line)] px-3.5 py-3 outline-none hover:bg-[var(--g-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--g-accent)]"
              >
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">Want all {vaultOffer.count}?</span>{" "}
                  <span className="text-[var(--g-muted)]">
                    The Complete Vault unlocks with the same steps.
                  </span>
                </span>
                <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
              </a>
            )}

            <p className="text-center text-[13px] text-[var(--g-muted)]">
              Need it again later?{" "}
              <a
                href={`/s/${progress.statusToken}`}
                className="underline underline-offset-2 hover:text-[var(--g-fg)]"
              >
                Your download page
              </a>
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className="text-center text-sm text-[var(--g-danger)]">
      {message}
    </p>
  )
}
