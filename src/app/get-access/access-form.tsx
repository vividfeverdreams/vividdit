"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect, useState } from "react"

import { submitAccessProofAction } from "@/app/get-access/actions"
import { CREATOR_INSTAGRAM_URL } from "@/lib/creator-access-constants"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial = { confirmed: false, message: "" }

export function AccessForm() {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(
    submitAccessProofAction,
    initial
  )
  const [hasFile, setHasFile] = useState(false)

  useEffect(() => {
    if (state.confirmed) {
      const t = setTimeout(() => router.push("/onboarding"), 1200)
      return () => clearTimeout(t)
    }
  }, [state.confirmed, router])

  return (
    <div className="space-y-4">
      <Button
        onClick={() =>
          window.open(
            CREATOR_INSTAGRAM_URL,
            "vividdit-ig",
            window.innerWidth > 900 ? "width=1100,height=850,noopener" : "noopener"
          )
        }
        className="w-full"
      >
        Open the Instagram profile ↗
      </Button>

      {state.message && (
        <Alert variant={state.confirmed ? "default" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {!state.confirmed && (
        <form action={formAction} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="proofs">
              Screenshot your Instagram showing “Following”
            </Label>
            <Input
              id="proofs"
              name="proofs"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setHasFile(!!e.target.files?.length)}
            />
          </div>
          <Button type="submit" disabled={pending || !hasFile} className="w-full">
            {pending ? "Verifying…" : "Verify & unlock the tool"}
          </Button>
        </form>
      )}
    </div>
  )
}
