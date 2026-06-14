"use client"

import { useActionState } from "react"

import {
  removeResendKeyAction,
  saveResendKeyAction,
  testResendKeyAction,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: SettingsFormState = { error: null, success: null }

function StatusBadge({ status }: { status: string }) {
  if (status === "valid") return <Badge>Valid</Badge>
  if (status === "invalid") return <Badge variant="destructive">Invalid</Badge>
  return <Badge variant="secondary">Untested</Badge>
}

export function ResendKeySection({
  keyInfo,
}: {
  keyInfo: {
    keyHint: string | null
    fromEmail: string
    keyStatus: string
    lastTestedAt: string | null
    lastError: string | null
  } | null
}) {
  const [saveState, saveFormAction, savePending] = useActionState(
    saveResendKeyAction,
    initial
  )
  const [testState, testFormAction, testPending] = useActionState(
    testResendKeyAction,
    initial
  )
  const [removeState, removeFormAction, removePending] = useActionState(
    removeResendKeyAction,
    initial
  )

  const feedback = [saveState, testState, removeState].filter(
    (s) => s.error || s.success
  )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Email (Resend)</h2>
        <p className="text-sm text-muted-foreground">
          Bring your own{" "}
          <a
            href="https://resend.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Resend
          </a>{" "}
          key so download links and review updates email your fans from your own
          account — free up to 3,000 emails/month. Without it, fans still get
          their download from their status page, just no email. Your key is
          encrypted at rest and never sent to the browser.
        </p>
      </div>

      {feedback.map((s, i) => (
        <Alert key={i} variant={s.error ? "destructive" : "default"}>
          <AlertDescription>{s.error ?? s.success}</AlertDescription>
        </Alert>
      ))}

      {keyInfo && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <StatusBadge status={keyInfo.keyStatus} />
          <span className="font-mono">{keyInfo.keyHint}</span>
          <span className="text-muted-foreground">from {keyInfo.fromEmail}</span>
          {keyInfo.lastTestedAt && (
            <span className="text-muted-foreground">
              · tested {new Date(keyInfo.lastTestedAt).toLocaleString()}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <form action={testFormAction}>
              <Button type="submit" size="sm" variant="outline" disabled={testPending}>
                {testPending ? "Testing…" : "Test"}
              </Button>
            </form>
            <form action={removeFormAction}>
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={removePending}
              >
                Remove
              </Button>
            </form>
          </div>
          {keyInfo.lastError && (
            <p
              className={
                keyInfo.keyStatus === "valid"
                  ? "w-full text-muted-foreground"
                  : "w-full text-destructive"
              }
            >
              {keyInfo.lastError}
            </p>
          )}
        </div>
      )}

      <form action={saveFormAction} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="resendKey">
            {keyInfo ? "Replace Resend API key" : "Resend API key"}
          </Label>
          <Input
            id="resendKey"
            name="resendKey"
            type="password"
            placeholder="re_…"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fromEmail">Sender address</Label>
          <Input
            id="fromEmail"
            name="fromEmail"
            type="text"
            placeholder="Your Name <noreply@yourdomain.com>"
            defaultValue={keyInfo?.fromEmail ?? ""}
            required
          />
          <p className="text-xs text-muted-foreground">
            Must be from a domain you&apos;ve verified in Resend. For testing,
            use <span className="font-mono">onboarding@resend.dev</span> (only
            reaches your own Resend email).
          </p>
        </div>
        <Button type="submit" disabled={savePending}>
          {savePending ? "Saving…" : "Save email key"}
        </Button>
      </form>
    </section>
  )
}
