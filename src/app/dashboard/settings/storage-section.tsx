"use client"

import { useActionState, useState } from "react"

import {
  removeR2Action,
  saveR2Action,
  testR2Action,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: SettingsFormState = { error: null, success: null }

function StatusBadge({ status }: { status: string }) {
  if (status === "valid") return <Badge>Connected</Badge>
  if (status === "invalid") return <Badge variant="destructive">Invalid</Badge>
  return <Badge variant="secondary">Untested</Badge>
}

export function StorageSection({
  info,
  freeGateLimit,
}: {
  info: {
    accountId: string
    bucket: string
    status: string
    lastError: string | null
  } | null
  freeGateLimit: number
}) {
  const [saveState, saveAction, savePending] = useActionState(saveR2Action, initial)
  const [testState, testAction, testPending] = useActionState(testR2Action, initial)
  const [removeState, removeAction, removePending] = useActionState(
    removeR2Action,
    initial
  )
  const [open, setOpen] = useState(false)

  const feedback = [saveState, testState, removeState].filter(
    (s) => s.error || s.success
  )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Storage (Cloudflare R2)</h2>
        <p className="text-sm text-muted-foreground">
          The free plan includes {freeGateLimit} gates on Vividdit&apos;s
          storage. Connect your own{" "}
          <a
            href="https://developers.cloudflare.com/r2/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Cloudflare R2
          </a>{" "}
          bucket for <strong>unlimited gates</strong> — your HQ files and fan
          downloads run on your own bucket (R2 has no egress fees). Your secret
          is encrypted at rest.
        </p>
      </div>

      {feedback.map((s, i) => (
        <Alert key={i} variant={s.error ? "destructive" : "default"}>
          <AlertDescription>{s.error ?? s.success}</AlertDescription>
        </Alert>
      ))}

      {info && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <StatusBadge status={info.status} />
          <span className="font-mono">{info.bucket}</span>
          <span className="text-muted-foreground">acct {info.accountId.slice(0, 6)}…</span>
          <div className="ml-auto flex gap-2">
            <form action={testAction}>
              <Button type="submit" size="sm" variant="outline" disabled={testPending}>
                {testPending ? "Testing…" : "Test"}
              </Button>
            </form>
            <form action={removeAction}>
              <Button type="submit" size="sm" variant="destructive" disabled={removePending}>
                Remove
              </Button>
            </form>
          </div>
          {info.status === "invalid" && info.lastError && (
            <p className="w-full text-destructive">{info.lastError}</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {open ? "Hide R2 setup" : info ? "Update R2 credentials" : "Connect R2 for unlimited gates"}
      </button>

      {open && (
        <form action={saveAction} className="space-y-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label htmlFor="accountId">Cloudflare account ID</Label>
            <Input id="accountId" name="accountId" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bucket">R2 bucket name</Label>
            <Input id="bucket" name="bucket" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accessKeyId">R2 access key ID</Label>
            <Input id="accessKeyId" name="accessKeyId" autoComplete="off" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secret">R2 secret access key</Label>
            <Input id="secret" name="secret" type="password" autoComplete="off" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="publicBaseUrl">Public domain (optional)</Label>
            <Input id="publicBaseUrl" name="publicBaseUrl" placeholder="https://files.yourdomain.com" />
          </div>
          <p className="text-xs text-muted-foreground">
            In R2, create an API token with Object Read &amp; Write for this
            bucket. Add a CORS rule allowing <code>PUT</code> from{" "}
            <code>https://vividdit.com</code> so uploads work.
          </p>
          <Button type="submit" disabled={savePending}>
            {savePending ? "Saving…" : "Save R2 storage"}
          </Button>
        </form>
      )}
    </section>
  )
}
