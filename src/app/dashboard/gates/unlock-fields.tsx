"use client"

import { TriangleAlert } from "lucide-react"
import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { HEAVY_GATE_ASKS } from "@/lib/gate-asks"
import { cn } from "@/lib/utils"

export type UnlockMode = "quick" | "verified"

const MODES: { value: UnlockMode; title: string; badge?: string; body: string }[] = [
  {
    value: "quick",
    title: "Quick unlock",
    badge: "Recommended",
    body: "Fans tap each follow and download. No screenshots, no AI key needed.",
  },
  {
    value: "verified",
    title: "Verified",
    body: "Fans add a screenshot per step and your AI key checks them in the background. They still get the file right away.",
  },
]

export function UnlockModeField({
  value,
  onChange,
  hasValidKey,
}: {
  value: UnlockMode
  onChange: (mode: UnlockMode) => void
  hasValidKey: boolean
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">How fans unlock</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((mode) => (
          <label
            key={mode.value}
            className={cn(
              "relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              value === mode.value
                ? "border-foreground bg-muted/60"
                : "hover:bg-muted/40"
            )}
          >
            <input
              type="radio"
              name="unlockMode"
              value={mode.value}
              checked={value === mode.value}
              onChange={() => onChange(mode.value)}
              className="sr-only"
            />
            <span className="flex items-center gap-2 text-sm font-medium">
              {mode.title}
              {mode.badge && (
                <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                  {mode.badge}
                </span>
              )}
            </span>
            <span className="text-sm text-muted-foreground">{mode.body}</span>
          </label>
        ))}
      </div>
      {value === "verified" && !hasValidKey && (
        <Alert variant="destructive">
          <AlertDescription>
            Verified gates need a working OpenAI or OpenRouter key.{" "}
            <Link href="/dashboard/settings" className="underline">
              Add one in Settings.
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </fieldset>
  )
}

export function HeavyGateWarning({ asks }: { asks: number }) {
  if (asks <= HEAVY_GATE_ASKS) return null
  return (
    <div
      role="status"
      className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p>
        <span className="font-medium">This gate asks for {asks} things.</span>{" "}
        <span className="text-muted-foreground">
          Every extra step loses fans. Email plus two follows (your SoundCloud
          and Instagram) unlocks the most downloads.
        </span>
      </p>
    </div>
  )
}
