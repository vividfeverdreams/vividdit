"use client"

import { useActionState } from "react"

import { saveStatusEmailAction, type StatusEmailState } from "@/app/s/[token]/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: StatusEmailState = { error: null, saved: false }

export function StatusEmailForm({ statusToken }: { statusToken: string }) {
  const [state, formAction, pending] = useActionState(
    saveStatusEmailAction,
    initial
  )

  if (state.saved) {
    return (
      <p className="border-t pt-4 text-sm text-muted-foreground">
        ✓ We&apos;ll email you when the artist decides.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3 border-t pt-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="statusToken" value={statusToken} />
      <div className="space-y-2">
        <Label htmlFor="statusEmail">
          Get notified when the artist decides (optional)
        </Label>
        <Input
          id="statusEmail"
          name="email"
          type="email"
          placeholder="you@example.com"
        />
        <p className="text-xs text-muted-foreground">
          Used only for this download — you won&apos;t join any mailing list.
        </p>
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Notify me"}
      </Button>
    </form>
  )
}
