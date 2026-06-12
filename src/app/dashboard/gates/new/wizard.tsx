"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  checkSlugAction,
  createGateAction,
  resolveTrackAction,
} from "@/app/dashboard/gates/new/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import {
  uploadCoverImage,
  uploadHqFile,
  type HqUploadResult,
} from "@/lib/uploads"
import { slugify, slugRegex } from "@/lib/validation"

const STEPS = ["Track", "File", "Design", "Unlock", "Publish"] as const

const HQ_ACCEPT = ".wav,.aiff,.aif,.zip,.mp3,.flac"
const HQ_MAX_BYTES = 500 * 1024 * 1024
const COVER_MAX_BYTES = 10 * 1024 * 1024

type Track = {
  canonicalUrl: string
  title: string
  artist: string
  artworkUrl: string | null
}

export function GateWizard({
  artistSlug,
  defaultArtist,
  hasValidKey,
}: {
  artistSlug: string
  defaultArtist: string
  hasValidKey: boolean
}) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Step 1 — track
  const [urlInput, setUrlInput] = useState("")
  const [track, setTrack] = useState<Track | null>(null)
  const [resolving, startResolving] = useTransition()

  // Step 2 — HQ file
  const [asset, setAsset] = useState<HqUploadResult | null>(null)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)

  // Step 3 — design
  const [accentColor, setAccentColor] = useState("#18181b")
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [coverUploading, setCoverUploading] = useState(false)

  // Step 4 — unlock requirements
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [scEnabled, setScEnabled] = useState(false)
  const [requireLike, setRequireLike] = useState(true)
  const [requireRepost, setRequireRepost] = useState(false)
  const [requireFollow, setRequireFollow] = useState(false)
  const [requireProofCode, setRequireProofCode] = useState(true)

  // Step 5 — slug + publish
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const resolveTrack = () => {
    setError(null)
    startResolving(async () => {
      const result = await resolveTrackAction(urlInput.trim())
      if ("error" in result) {
        setError(result.error)
        return
      }
      setTrack(result)
      if (!result.artist && defaultArtist) {
        setTrack({ ...result, artist: defaultArtist })
      }
      if (!slugTouched) {
        setSlug(slugify(result.title))
      }
    })
  }

  const onHqFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > HQ_MAX_BYTES) {
      setError("HQ file is over the 500MB limit.")
      return
    }
    try {
      setUploadPercent(0)
      const result = await uploadHqFile(file, setUploadPercent)
      setAsset(result)
    } catch {
      setError("Upload failed. Check your connection and try again.")
    } finally {
      setUploadPercent(null)
    }
  }

  const onCoverFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > COVER_MAX_BYTES) {
      setError("Cover image is over the 10MB limit.")
      return
    }
    try {
      setCoverUploading(true)
      setCoverPath(await uploadCoverImage(file))
    } catch {
      setError("Cover upload failed. Try again.")
    } finally {
      setCoverUploading(false)
    }
  }

  const checkSlug = async (value: string) => {
    if (!slugRegex.test(value)) {
      setSlugAvailable(null)
      return
    }
    const { available } = await checkSlugAction(value)
    setSlugAvailable(available)
  }

  const submit = async (publish: boolean) => {
    if (!track) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await createGateAction({
        soundcloudUrl: track.canonicalUrl,
        title: track.title,
        artist: track.artist,
        slug,
        artworkUrl: track.artworkUrl,
        accentColor,
        coverPath,
        emailEnabled,
        soundcloudEnabled: scEnabled,
        requireLike,
        requireRepost,
        requireFollow,
        requireProofCode,
        asset,
        publish,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push("/dashboard?created=" + (result.published ? "published" : "draft"))
    } finally {
      setSubmitting(false)
    }
  }

  const canLeaveStep = (s: number): string | null => {
    if (s === 0 && !track) return "Fetch your track first."
    if (s === 0 && track && (!track.title || !track.artist))
      return "Fill in the track title and artist."
    if (s === 3 && !emailEnabled && !scEnabled)
      return "Enable at least one unlock requirement."
    if (s === 3 && scEnabled && !requireLike && !requireRepost && !requireFollow)
      return "Pick at least one SoundCloud action."
    return null
  }

  const next = () => {
    const blocked = canLeaveStep(step)
    if (blocked) {
      setError(blocked)
      return
    }
    setError(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  return (
    <div className="space-y-6">
      <ol className="flex gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={
              i === step
                ? "font-medium text-foreground"
                : i < step
                  ? "text-foreground/60"
                  : "text-muted-foreground"
            }
          >
            {i + 1}. {label}
            {i < STEPS.length - 1 && <span className="ml-2">→</span>}
          </li>
        ))}
      </ol>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="scUrl">SoundCloud track URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="scUrl"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://soundcloud.com/… or share link"
                  />
                  <Button onClick={resolveTrack} disabled={resolving || !urlInput.trim()}>
                    {resolving ? "Fetching…" : "Fetch"}
                  </Button>
                </div>
              </div>
              {track && (
                <div className="flex gap-4 rounded-lg border p-4">
                  {track.artworkUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.artworkUrl}
                      alt=""
                      className="size-20 rounded-md object-cover"
                    />
                  )}
                  <div className="flex-1 space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="title">Title</Label>
                      <Input
                        id="title"
                        value={track.title}
                        onChange={(e) => {
                          setTrack({ ...track, title: e.target.value })
                          if (!slugTouched) setSlug(slugify(e.target.value))
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="artist">Artist</Label>
                      <Input
                        id="artist"
                        value={track.artist}
                        onChange={(e) => setTrack({ ...track, artist: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <Label htmlFor="hqFile">HQ download file (WAV, AIFF, ZIP — up to 500MB)</Label>
              <Input
                id="hqFile"
                type="file"
                accept={HQ_ACCEPT}
                onChange={(e) => onHqFile(e.target.files?.[0])}
                disabled={uploadPercent !== null}
              />
              {uploadPercent !== null && (
                <div className="space-y-1">
                  <Progress value={uploadPercent} />
                  <p className="text-xs text-muted-foreground">
                    Uploading… {uploadPercent}%
                  </p>
                </div>
              )}
              {asset && (
                <p className="text-sm">
                  ✓ <span className="font-medium">{asset.filename}</span>{" "}
                  <span className="text-muted-foreground">
                    ({(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Stored privately — fans only get short-lived signed links after
                unlocking. You can skip this for now, but it's required to publish.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="accent">Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="accent"
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="size-8 cursor-pointer rounded border"
                  />
                  <span className="font-mono text-sm">{accentColor}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cover">Custom cover image (optional)</Label>
                <Input
                  id="cover"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => onCoverFile(e.target.files?.[0])}
                  disabled={coverUploading}
                />
                <p className="text-xs text-muted-foreground">
                  {coverPath
                    ? "✓ Custom cover uploaded."
                    : "Defaults to your SoundCloud artwork."}
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="emailGate">Email gate</Label>
                  <p className="text-sm text-muted-foreground">
                    Fans submit their email to unlock.
                  </p>
                </div>
                <Switch
                  id="emailGate"
                  checked={emailEnabled}
                  onCheckedChange={setEmailEnabled}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="scGate">SoundCloud gate</Label>
                  <p className="text-sm text-muted-foreground">
                    Fans prove like/repost/follow with screenshots, verified by AI.
                  </p>
                </div>
                <Switch id="scGate" checked={scEnabled} onCheckedChange={setScEnabled} />
              </div>
              {scEnabled && (
                <div className="space-y-3 rounded-lg border p-4">
                  {!hasValidKey && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        You need a valid OpenAI key to publish a SoundCloud gate.{" "}
                        <Link href="/dashboard/settings" className="underline">
                          Add one in Settings.
                        </Link>
                      </AlertDescription>
                    </Alert>
                  )}
                  {(
                    [
                      ["Like the track", requireLike, setRequireLike],
                      ["Repost the track", requireRepost, setRequireRepost],
                      ["Follow you on SoundCloud", requireFollow, setRequireFollow],
                    ] as const
                  ).map(([label, checked, set]) => (
                    <label key={label} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => set(e.target.checked)}
                        className="size-4"
                      />
                      {label}
                    </label>
                  ))}
                  <div className="flex items-center justify-between border-t pt-3">
                    <div>
                      <Label htmlFor="proofCode">Proof code</Label>
                      <p className="text-sm text-muted-foreground">
                        Fans paste a unique code into the comment box before
                        screenshotting — strong anti-fake signal.
                      </p>
                    </div>
                    <Switch
                      id="proofCode"
                      checked={requireProofCode}
                      onCheckedChange={setRequireProofCode}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="slug">Gate URL</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    vividdit.com/{artistSlug}/
                  </span>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      setSlug(e.target.value)
                      setSlugAvailable(null)
                    }}
                    onBlur={(e) => checkSlug(e.target.value)}
                  />
                </div>
                {slugAvailable === false && (
                  <p className="text-sm text-destructive">
                    You already use that slug.
                  </p>
                )}
                {slugAvailable === true && (
                  <p className="text-sm text-muted-foreground">✓ Available</p>
                )}
                <p className="text-xs text-muted-foreground">
                  The URL is locked once you publish.
                </p>
              </div>

              <div className="rounded-lg border p-4 text-sm space-y-1">
                <p className="font-medium">{track?.title}</p>
                <p className="text-muted-foreground">{track?.artist}</p>
                <p className="text-muted-foreground">
                  {asset ? `File: ${asset.filename}` : "No HQ file uploaded yet"}
                </p>
                <p className="text-muted-foreground">
                  Unlock:{" "}
                  {[
                    emailEnabled && "email",
                    scEnabled &&
                      `SoundCloud (${[
                        requireLike && "like",
                        requireRepost && "repost",
                        requireFollow && "follow",
                      ]
                        .filter(Boolean)
                        .join(", ")})`,
                  ]
                    .filter(Boolean)
                    .join(" + ")}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>Continue</Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => submit(false)}
              disabled={submitting || !slugRegex.test(slug)}
            >
              Save draft
            </Button>
            <Button
              onClick={() => submit(true)}
              disabled={submitting || !slugRegex.test(slug) || !asset}
            >
              {submitting ? "Publishing…" : "Publish gate"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
