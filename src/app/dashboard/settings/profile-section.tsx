"use client"

import { useActionState } from "react"

import {
  updateProfileAction,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: SettingsFormState = { error: null, success: null }

export function ProfileSection({
  profile,
}: {
  profile: {
    artistName: string
    artistSlug: string
    soundcloudProfileUrl: string
  }
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    initial
  )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Artist profile</h2>
        <p className="text-sm text-muted-foreground">
          Shown to fans on your gate pages.
        </p>
      </div>

      {(state.error || state.success) && (
        <Alert variant={state.error ? "destructive" : "default"}>
          <AlertDescription>{state.error ?? state.success}</AlertDescription>
        </Alert>
      )}

      <form action={formAction} className="max-w-md space-y-4">
        <div className="space-y-2">
          <Label htmlFor="artistName">Artist name</Label>
          <Input
            id="artistName"
            name="artistName"
            defaultValue={profile.artistName}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Artist URL</Label>
          <Input value={`vividdit.com/${profile.artistSlug}`} disabled />
          <p className="text-xs text-muted-foreground">
            Your artist URL is permanent.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="soundcloudProfileUrl">SoundCloud profile URL</Label>
          <Input
            id="soundcloudProfileUrl"
            name="soundcloudProfileUrl"
            type="url"
            defaultValue={profile.soundcloudProfileUrl}
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </section>
  )
}
