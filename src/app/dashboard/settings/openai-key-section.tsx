"use client"

import { useActionState, useState } from "react"

import {
  removeKeyAction,
  saveKeyAction,
  setModelAction,
  testKeyAction,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions"
import {
  OPENROUTER_SUGGESTED_MODELS,
  PROVIDER_LABELS,
  VERIFICATION_MODELS,
  type AiProvider,
} from "@/lib/ai-models"
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

export function OpenAiKeySection({
  keyInfo,
}: {
  keyInfo: {
    provider: AiProvider
    keyHint: string | null
    keyStatus: string
    model: string
    lastTestedAt: string | null
    lastError: string | null
  } | null
}) {
  const [saveState, saveFormAction, savePending] = useActionState(
    saveKeyAction,
    initial
  )
  const [testState, testFormAction, testPending] = useActionState(
    testKeyAction,
    initial
  )
  const [removeState, removeFormAction, removePending] = useActionState(
    removeKeyAction,
    initial
  )
  const [modelState, modelFormAction, modelPending] = useActionState(
    setModelAction,
    initial
  )
  const [showAdvanced, setShowAdvanced] = useState(false)

  const feedback = [saveState, testState, removeState, modelState].filter(
    (s) => s.error || s.success
  )

  const isOpenRouter = keyInfo?.provider === "openrouter"

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Verification API key</h2>
        <p className="text-sm text-muted-foreground">
          Used to verify fan proof screenshots with AI. Required before
          publishing a SoundCloud gate; email-only gates work without it. Paste
          an <strong>OpenAI</strong> key (<code className="rounded bg-muted px-1">sk-…</code>){" "}
          or an{" "}
          <a
            href="https://openrouter.ai/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline"
          >
            OpenRouter
          </a>{" "}
          key (<code className="rounded bg-muted px-1">sk-or-…</code>) — OpenRouter
          lets you use many different models (Gemini, Claude, GPT, etc.) with one
          key. Your key is encrypted at rest and never sent to the browser. New
          to this? Step-by-step guides:{" "}
          <a
            href="/guides/openai-api-key"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline"
          >
            OpenAI
          </a>{" "}
          ·{" "}
          <a
            href="/guides/openrouter"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline"
          >
            OpenRouter
          </a>
          .
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
          <Badge variant="outline">{PROVIDER_LABELS[keyInfo.provider]}</Badge>
          <span className="font-mono">{keyInfo.keyHint}</span>
          {keyInfo.lastTestedAt && (
            <span className="text-muted-foreground">
              Last tested {new Date(keyInfo.lastTestedAt).toLocaleString()}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <form action={testFormAction}>
              <Button type="submit" size="sm" variant="outline" disabled={testPending}>
                {testPending ? "Testing…" : "Test key"}
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
          {keyInfo.keyStatus === "invalid" && keyInfo.lastError && (
            <p className="w-full text-destructive">{keyInfo.lastError}</p>
          )}
        </div>
      )}

      <form action={saveFormAction} className="space-y-2">
        <Label htmlFor="apiKey">
          {keyInfo ? "Replace key" : "Add your OpenAI or OpenRouter API key"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="apiKey"
            name="apiKey"
            type="password"
            placeholder="sk-… or sk-or-…"
            autoComplete="off"
            required
          />
          <Button type="submit" disabled={savePending}>
            {savePending ? "Saving…" : "Save key"}
          </Button>
        </div>
      </form>

      {keyInfo && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            {showAdvanced ? "Hide advanced settings" : "Advanced settings"}
          </button>
          {showAdvanced && (
            <form action={modelFormAction} className="flex items-end gap-2">
              <div className="space-y-2">
                <Label htmlFor="model">Verification model</Label>
                {isOpenRouter ? (
                  <>
                    <Input
                      id="model"
                      name="model"
                      defaultValue={keyInfo.model}
                      list="openrouter-models"
                      placeholder="openai/gpt-4o-mini"
                      className="w-72 font-mono"
                    />
                    <datalist id="openrouter-models">
                      {OPENROUTER_SUGGESTED_MODELS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <p className="text-xs text-muted-foreground">
                      Any model id from{" "}
                      <a
                        href="https://openrouter.ai/models"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        openrouter.ai/models
                      </a>
                      . Use a vision model that supports structured output
                      (OpenAI and Google models work well).
                    </p>
                  </>
                ) : (
                  <select
                    id="model"
                    name="model"
                    defaultValue={keyInfo.model}
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    {VERIFICATION_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                        {m === "gpt-5.4-mini" ? " (recommended)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={modelPending}>
                Save model
              </Button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
