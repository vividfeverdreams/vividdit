"use client"

import { useState } from "react"

import { getVaultRescueLinkAction } from "@/app/dashboard/vault-rescue-actions"
import { Button } from "@/components/ui/button"

export function VaultRescueLink({
  vaultId,
  initialUrl,
}: {
  vaultId: string
  initialUrl: string | null
}) {
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState<"create" | "rotate" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setMessage("Copied!")
    } catch {
      setMessage("Link ready — copy it from the field below.")
    }
    setTimeout(() => setMessage(null), 2500)
  }

  const prepare = async (rotate: boolean) => {
    setBusy(rotate ? "rotate" : "create")
    setError(null)
    setMessage(null)
    try {
      const result = await getVaultRescueLinkAction(vaultId, rotate)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setUrl(result.url)
      await copy(result.url)
    } catch {
      setError("Couldn't prepare the rescue link. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => (url ? copy(url) : prepare(false))}
        >
          {busy === "create"
            ? "Creating…"
            : url
              ? "Copy rescue link"
              : "Create rescue link"}
        </Button>
        {url && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => prepare(true)}
          >
            {busy === "rotate" ? "Rotating…" : "Rotate link"}
          </Button>
        )}
        {message && (
          <span className="text-xs text-muted-foreground" role="status">
            {message}
          </span>
        )}
      </div>
      {url && (
        <input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Vault rescue link"
          className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs"
        />
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
