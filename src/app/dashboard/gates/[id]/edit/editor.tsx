"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { updateGateAction } from "@/app/dashboard/gates/[id]/edit/actions"
import { FollowList, GatePreview } from "@/app/dashboard/gates/new/wizard"
import { setGateInVault } from "@/app/dashboard/vault-actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { extractPaletteFromImage } from "@/lib/palette-client"

type Initial = {
  accentColor: string
  backgroundColor: string
  emailEnabled: boolean
  requireLike: boolean
  requireRepost: boolean
  requireProofCode: boolean
  scFollows: string[]
  igFollows: string[]
  spFollows: string[]
}

type VaultTrack = { id: string; title: string; inVault: boolean }

export function GateEditor({
  gateId,
  status,
  title,
  artist,
  coverUrl,
  hasValidKey,
  isVault = false,
  vaultTracks = [],
  initial,
}: {
  gateId: string
  status: string
  title: string
  artist: string
  coverUrl: string | null
  hasValidKey: boolean
  isVault?: boolean
  vaultTracks?: VaultTrack[]
  initial: Initial
}) {
  const router = useRouter()

  const [included, setIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(vaultTracks.map((t) => [t.id, t.inVault]))
  )
  const toggleVaultTrack = (id: string, value: boolean) => {
    setIncluded((prev) => ({ ...prev, [id]: value }))
    void setGateInVault(id, value)
  }

  const [accentColor, setAccentColor] = useState(initial.accentColor)
  const [backgroundColor, setBackgroundColor] = useState(initial.backgroundColor)
  const [emailEnabled, setEmailEnabled] = useState(initial.emailEnabled)
  const [requireLike, setRequireLike] = useState(initial.requireLike)
  const [requireRepost, setRequireRepost] = useState(initial.requireRepost)
  const [requireProofCode, setRequireProofCode] = useState(initial.requireProofCode)
  const [scFollows, setScFollows] = useState<string[]>(initial.scFollows)
  const [igFollows, setIgFollows] = useState<string[]>(initial.igFollows)
  const [spFollows, setSpFollows] = useState<string[]>(initial.spFollows)

  const [pullingColors, setPullingColors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trackActions = requireLike || requireRepost
  const allFollows = [
    ...scFollows.map((url) => ({ platform: "soundcloud" as const, url })),
    ...igFollows.map((url) => ({ platform: "instagram" as const, url })),
    ...spFollows.map((url) => ({ platform: "spotify" as const, url })),
  ].filter((t) => t.url.trim())
  const aiGate = trackActions || allFollows.length > 0

  const pullColors = async () => {
    if (!coverUrl) return
    setPullingColors(true)
    try {
      const palette = await extractPaletteFromImage(coverUrl)
      if (palette) {
        setAccentColor(palette.accent)
        setBackgroundColor(palette.background)
      }
    } finally {
      setPullingColors(false)
    }
  }

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await updateGateAction({
        gateId,
        accentColor,
        backgroundColor,
        emailEnabled,
        requireLike,
        requireRepost,
        requireProofCode,
        followTargets: allFollows,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push("/dashboard?updated=1")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Download Gates
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit gate</h1>
        <p className="text-sm text-muted-foreground">
          {title} — {artist}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {status === "published" && (
        <Alert>
          <AlertDescription>
            This gate is live — saving updates the existing download page
            immediately.
          </AlertDescription>
        </Alert>
      )}

      {/* Requirements */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <h2 className="font-medium">Unlock requirements</h2>

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

          {aiGate && !hasValidKey && (
            <Alert variant="destructive">
              <AlertDescription>
                Follow/like/repost gates need a valid OpenAI key to stay live.{" "}
                <Link href="/dashboard/settings" className="underline">
                  Add one in Settings.
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {!isVault && (
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
                      Fans paste a unique code into the comment box — strong
                      anti-fake signal.
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
          )}

          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-sm font-medium">Follow profiles</p>
            <FollowList
              label="SoundCloud profiles to follow"
              urls={scFollows}
              onChange={setScFollows}
              placeholder="https://soundcloud.com/artist"
            />
            <FollowList
              label="Instagram profiles to follow"
              urls={igFollows}
              onChange={setIgFollows}
              placeholder="https://instagram.com/handle"
            />
            <FollowList
              label="Spotify profiles to follow"
              urls={spFollows}
              onChange={setSpFollows}
              placeholder="https://open.spotify.com/artist/…"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tracks in the vault */}
      {isVault && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <h2 className="font-medium">Tracks in your vault</h2>
              <p className="text-sm text-muted-foreground">
                New published tracks are added automatically. Toggle any off to
                leave it out of the vault.
              </p>
            </div>
            {vaultTracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No published tracks yet — publish a gate and it&apos;ll show up
                here.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {vaultTracks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.title}
                    </span>
                    <Switch
                      checked={included[t.id] ?? true}
                      onCheckedChange={(v) => toggleVaultTrack(t.id, v)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Colors */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-medium">Colors</h2>
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
          {coverUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pullColors}
              disabled={pullingColors}
            >
              {pullingColors ? "Reading cover…" : "🎨 Pull colors from cover art"}
            </Button>
          )}

          <div className="space-y-2 border-t pt-4">
            <Label>Live preview</Label>
            <GatePreview
              accent={accentColor}
              background={backgroundColor}
              coverUrl={coverUrl}
              title={title}
              artist={artist}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          render={<Link href="/dashboard" />}
          nativeButton={false}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}
