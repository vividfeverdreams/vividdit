"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  checkSlugAction,
  createGateAction,
  extractPaletteAction,
  getHqUploadTargetAction,
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
  uploadToPresignedUrl,
  type HqUploadResult,
} from "@/lib/uploads"
import { muted, readableForeground } from "@/lib/colors"
import { slugify, slugRegex } from "@/lib/validation"

type Asset = HqUploadResult & { storageProvider: "supabase" | "r2" }

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
  ownProfiles,
}: {
  artistSlug: string
  defaultArtist: string
  hasValidKey: boolean
  ownProfiles: {
    soundcloud: string | null
    instagram: string | null
    spotify: string | null
  }
}) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Step 1 — track
  const [urlInput, setUrlInput] = useState("")
  const [track, setTrack] = useState<Track | null>(null)
  const [resolving, startResolving] = useTransition()

  // Step 2 — HQ file
  const [asset, setAsset] = useState<Asset | null>(null)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)

  // Step 3 — design
  const [accentColor, setAccentColor] = useState("#18181b")
  const [backgroundColor, setBackgroundColor] = useState("#0a0a0a")
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [coverUploading, setCoverUploading] = useState(false)
  const [pullingColors, setPullingColors] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Step 3 — tracking pixels (optional)
  const [showTracking, setShowTracking] = useState(false)
  const [fbPixel, setFbPixel] = useState("")
  const [googleTag, setGoogleTag] = useState("")
  const [googleLabel, setGoogleLabel] = useState("")
  const [tiktokPixel, setTiktokPixel] = useState("")

  // Step 4 — unlock requirements
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [requireLike, setRequireLike] = useState(false)
  const [requireRepost, setRequireRepost] = useState(false)
  const [requireProofCode, setRequireProofCode] = useState(false)
  // Multiple follow profiles per platform (each becomes a fan step).
  const [scFollows, setScFollows] = useState<string[]>([])
  const [igFollows, setIgFollows] = useState<string[]>([])
  const [spFollows, setSpFollows] = useState<string[]>([])

  const trackActions = requireLike || requireRepost
  const allFollows = [
    ...scFollows.map((url) => ({ platform: "soundcloud" as const, url })),
    ...igFollows.map((url) => ({ platform: "instagram" as const, url })),
    ...spFollows.map((url) => ({ platform: "spotify" as const, url })),
  ].filter((t) => t.url.trim())

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
      // Auto-suggest theme colors from the cover art — best-effort, must
      // never block track resolution.
      if (result.artworkUrl) {
        try {
          const palette = await extractPaletteAction(result.artworkUrl)
          if (palette) {
            setAccentColor(palette.accent)
            setBackgroundColor(palette.background)
          }
        } catch {
          // ignore — artist can pick colors manually
        }
      }
    })
  }

  const pullColorsFromCover = async () => {
    const url = coverPath
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/${coverPath}`
      : track?.artworkUrl
    if (!url) return
    setPullingColors(true)
    try {
      const palette = await extractPaletteAction(url)
      if (palette) {
        setAccentColor(palette.accent)
        setBackgroundColor(palette.background)
      }
    } catch {
      // ignore — colors are optional
    } finally {
      setPullingColors(false)
    }
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
      const target = await getHqUploadTargetAction(file.name, file.type || "application/octet-stream")
      if ("error" in target) {
        setError(target.error)
        return
      }
      if (target.provider === "r2") {
        await uploadToPresignedUrl(target.uploadUrl, file, setUploadPercent)
        setAsset({
          storagePath: target.objectKey,
          filename: file.name,
          sizeBytes: file.size,
          mimeType: file.type || "application/octet-stream",
          storageProvider: "r2",
        })
      } else {
        const result = await uploadHqFile(file, setUploadPercent)
        setAsset({ ...result, storageProvider: "supabase" })
      }
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
      setCoverPreview(URL.createObjectURL(file))
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
        backgroundColor,
        coverPath,
        emailEnabled,
        requireLike,
        requireRepost,
        requireProofCode,
        followTargets: allFollows,
        tracking: {
          facebookPixelId: fbPixel.trim() || null,
          googleAdsTagId: googleTag.trim() || null,
          googleConversionLabel: googleLabel.trim() || null,
          tiktokPixelId: tiktokPixel.trim() || null,
        },
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
    if (s === 3 && !emailEnabled && !trackActions && allFollows.length === 0)
      return "Enable at least one unlock requirement."
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
              <label
                htmlFor="hqFile"
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  if (uploadPercent === null) onHqFile(e.dataTransfer.files?.[0])
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors ${
                  dragOver
                    ? "border-primary bg-muted"
                    : "border-input hover:bg-muted/50"
                }`}
              >
                <span className="font-medium">
                  Drag &amp; drop your file here
                </span>
                <span className="text-muted-foreground">or click to browse</span>
              </label>
              <Input
                id="hqFile"
                type="file"
                accept={HQ_ACCEPT}
                onChange={(e) => onHqFile(e.target.files?.[0])}
                disabled={uploadPercent !== null}
                className="sr-only"
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
              <div className="flex flex-wrap gap-6">
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
                  <Label htmlFor="bg">Background color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="bg"
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="size-8 cursor-pointer rounded border"
                    />
                    <span className="font-mono text-sm">{backgroundColor}</span>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pullColorsFromCover}
                disabled={pullingColors || (!coverPath && !track?.artworkUrl)}
              >
                {pullingColors ? "Reading cover…" : "🎨 Pull colors from cover art"}
              </Button>

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

              <div className="space-y-2 border-t pt-4">
                <Label>Live preview</Label>
                <GatePreview
                  accent={accentColor}
                  background={backgroundColor}
                  coverUrl={coverPreview ?? track?.artworkUrl ?? null}
                  title={track?.title ?? "Your track title"}
                  artist={track?.artist ?? "Artist"}
                />
              </div>

              <div className="space-y-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowTracking((v) => !v)}
                  className="text-sm text-muted-foreground underline underline-offset-4"
                >
                  {showTracking
                    ? "Hide ad tracking pixels"
                    : "Add ad tracking pixels (optional)"}
                </button>
                {showTracking && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Track visits and downloads in your own ad accounts for
                      retargeting. Fans see a consent notice; pixels only load
                      after they accept.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="fbPixel">Facebook Pixel ID</Label>
                      <Input
                        id="fbPixel"
                        value={fbPixel}
                        onChange={(e) => setFbPixel(e.target.value)}
                        placeholder="e.g. 123456789012345"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="googleTag">Google Ads tag ID</Label>
                      <Input
                        id="googleTag"
                        value={googleTag}
                        onChange={(e) => setGoogleTag(e.target.value)}
                        placeholder="AW-XXXXXXXXX"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="googleLabel">
                        Google Ads conversion label (download)
                      </Label>
                      <Input
                        id="googleLabel"
                        value={googleLabel}
                        onChange={(e) => setGoogleLabel(e.target.value)}
                        placeholder="Conversion label"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tiktokPixel">TikTok Pixel ID</Label>
                      <Input
                        id="tiktokPixel"
                        value={tiktokPixel}
                        onChange={(e) => setTiktokPixel(e.target.value)}
                        placeholder="e.g. C9XXXXXXXXXXXXXXXXXX"
                      />
                    </div>
                  </div>
                )}
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

              {(trackActions || allFollows.length > 0) && !hasValidKey && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Follow/like/repost gates need a valid OpenAI key to publish.{" "}
                    <Link href="/dashboard/settings" className="underline">
                      Add one in Settings.
                    </Link>
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">SoundCloud track actions</p>
                {(
                  [
                    ["Like the track", requireLike, setRequireLike],
                    ["Repost the track", requireRepost, setRequireRepost],
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
                {trackActions && (
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
                )}
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm font-medium">Follow profiles</p>
                <p className="text-xs text-muted-foreground">
                  Add as many as you need — e.g. each featured artist. Every
                  profile becomes its own step for the fan.
                </p>
                <FollowList
                  label="SoundCloud profiles to follow"
                  urls={scFollows}
                  onChange={setScFollows}
                  placeholder="https://soundcloud.com/artist"
                  own={ownProfiles.soundcloud}
                />
                <FollowList
                  label="Instagram profiles to follow"
                  urls={igFollows}
                  onChange={setIgFollows}
                  placeholder="https://instagram.com/handle"
                  own={ownProfiles.instagram}
                />
                <FollowList
                  label="Spotify profiles to follow"
                  urls={spFollows}
                  onChange={setSpFollows}
                  placeholder="https://open.spotify.com/artist/…"
                  own={ownProfiles.spotify}
                />
              </div>
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
                    requireLike && "like",
                    requireRepost && "repost",
                    allFollows.length > 0 &&
                      `${allFollows.length} follow${allFollows.length > 1 ? "s" : ""}`,
                  ]
                    .filter(Boolean)
                    .join(" + ") || "nothing yet"}
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

function FollowList({
  label,
  urls,
  onChange,
  placeholder,
  own,
}: {
  label: string
  urls: string[]
  onChange: (urls: string[]) => void
  placeholder: string
  own?: string | null
}) {
  const canAddOwn = !!own && !urls.includes(own)
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {canAddOwn && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...urls.filter((u) => u.trim()), own!])}
        >
          + Add my profile
        </Button>
      )}
      {urls.map((u, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={u}
            onChange={(e) => {
              const next = [...urls]
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder={placeholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(urls.filter((_, j) => j !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...urls, ""])}
      >
        + Add profile
      </Button>
    </div>
  )
}

function GatePreview({
  accent,
  background,
  coverUrl,
  title,
  artist,
}: {
  accent: string
  background: string
  coverUrl: string | null
  title: string
  artist: string
}) {
  const fg = readableForeground(background)
  return (
    <div
      className="mx-auto w-full max-w-xs overflow-hidden rounded-xl border shadow-sm"
      style={{ backgroundColor: background, color: fg }}
    >
      <div className="space-y-3 p-4">
        {/* big cover */}
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            className="aspect-square w-full rounded-lg object-cover"
          />
        ) : (
          <div className="aspect-square w-full rounded-lg bg-white/10" />
        )}

        <div className="min-w-0">
          <p
            className="text-[10px] font-medium tracking-widest uppercase"
            style={{ color: accent }}
          >
            Free download
          </p>
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-xs" style={{ color: muted(fg, 0.65) }}>
            {artist}
          </p>
        </div>

        {/* unlock card */}
        <div className="space-y-2 rounded-lg bg-white p-3 text-zinc-900">
          <p className="text-xs font-medium">Unlock the HQ download</p>
          <div
            className="flex h-8 items-center justify-center rounded-md text-xs font-medium text-white"
            style={{ backgroundColor: accent }}
          >
            Get the download
          </div>
        </div>
      </div>
    </div>
  )
}
