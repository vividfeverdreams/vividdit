"use client"

import { useActionState, useState } from "react"

import {
  completeOnboarding,
  type OnboardingFormState,
} from "@/app/onboarding/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { slugify } from "@/lib/validation"

const initialState: OnboardingFormState = { error: null }

export function OnboardingForm({
  defaults,
}: {
  defaults: {
    artistName: string
    artistSlug: string
    soundcloudProfileUrl: string
    slugLocked: boolean
  }
}) {
  const [state, formAction, pending] = useActionState(
    completeOnboarding,
    initialState
  )
  const [artistName, setArtistName] = useState(defaults.artistName)
  const [slug, setSlug] = useState(defaults.artistSlug)
  const [slugTouched, setSlugTouched] = useState(defaults.slugLocked)

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="artistName">Artist name</Label>
        <Input
          id="artistName"
          name="artistName"
          value={artistName}
          onChange={(e) => {
            setArtistName(e.target.value)
            if (!slugTouched) setSlug(slugify(e.target.value))
          }}
          placeholder="e.g. Vivid Dreams"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="artistSlug">Artist URL</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">vividdit.com/</span>
          <Input
            id="artistSlug"
            name="artistSlug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value)
            }}
            disabled={defaults.slugLocked}
            placeholder="vivid-dreams"
            required
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {defaults.slugLocked
            ? "Your artist URL is permanent."
            : "Lowercase letters, numbers, and hyphens. This can't be changed later."}
        </p>
        {defaults.slugLocked && (
          <input type="hidden" name="artistSlug" value={defaults.artistSlug} />
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="soundcloudProfileUrl">SoundCloud profile URL</Label>
        <Input
          id="soundcloudProfileUrl"
          name="soundcloudProfileUrl"
          type="url"
          defaultValue={defaults.soundcloudProfileUrl}
          placeholder="https://soundcloud.com/your-artist-name"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  )
}
