import Link from "next/link"

import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Get your OpenRouter API key",
  description:
    "Step-by-step guide to creating an OpenRouter API key so Vividdit can verify fan proof screenshots using the model of your choice.",
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="relative pl-12">
      <span className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </li>
  )
}

export default function OpenRouterGuide() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link
        href="/"
        className="text-sm font-medium tracking-widest uppercase text-muted-foreground"
      >
        Vividdit
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Get your OpenRouter API key
      </h1>
      <p className="mt-2 text-muted-foreground">
        OpenRouter is one key that works across many AI models — OpenAI&apos;s
        GPT, Google&apos;s Gemini, Anthropic&apos;s Claude, and more. Vividdit
        uses it to verify the screenshots fans upload as proof, so you can pick
        whichever model you like best (or the cheapest one). This takes about 5
        minutes — no technical experience needed. Follow each step.
      </p>

      <div className="mt-6 rounded-lg border bg-muted/50 p-4 text-sm">
        <p className="font-medium">
          By the end you&apos;ll have two things to put into Vividdit:
        </p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          <li>
            An API key that starts with{" "}
            <code className="rounded bg-muted px-1">sk-or-</code>
          </li>
          <li>
            A model id like{" "}
            <code className="rounded bg-muted px-1">openai/gpt-4o-mini</code>
          </li>
        </ul>
      </div>

      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
        <p className="font-medium">What does it cost?</p>
        <p className="mt-1 text-muted-foreground">
          Almost nothing. Verifying one fan&apos;s screenshots costs a fraction
          of a cent on a cheap vision model (e.g.{" "}
          <code className="rounded bg-muted px-1">openai/gpt-4o-mini</code> or{" "}
          <code className="rounded bg-muted px-1">google/gemini-2.5-flash</code>
          ). OpenRouter is pay-as-you-go — you add a little credit up front and
          only pay for what you use. Most artists add <strong>$5–10</strong> once
          and it lasts a long time.
        </p>
      </div>

      <ol className="mt-8 space-y-8">
        <Step n={1} title="Create an OpenRouter account">
          <p>
            Go to{" "}
            <a
              href="https://openrouter.ai/"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              openrouter.ai
            </a>{" "}
            and sign in (you can use Google, GitHub, or email). It&apos;s free to
            create an account.
          </p>
        </Step>

        <Step n={2} title="Add a little credit">
          <p>
            Open{" "}
            <a
              href="https://openrouter.ai/settings/credits"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              Settings → Credits
            </a>
            , click <strong>Add Credits</strong>, and add <strong>$5–10</strong>.
            That&apos;s plenty to verify hundreds of fans on a cheap model.
          </p>
        </Step>

        <Step n={3} title="Create an API key">
          <p>
            Go to{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              openrouter.ai/keys
            </a>
            , click <strong>Create Key</strong>, give it a name like{" "}
            <code className="rounded bg-muted px-1">vividdit</code>, and create
            it. You can optionally set a credit limit on the key to cap spending.
          </p>
          <p>
            OpenRouter shows a key that starts with{" "}
            <code className="rounded bg-muted px-1">sk-or-</code>.{" "}
            <strong>Copy it now — it&apos;s only shown once.</strong> If you lose
            it, just delete it and make a new one.
          </p>
          <p>
            👉 That&apos;s your <strong>OpenRouter API key</strong> for Vividdit.
          </p>
        </Step>

        <Step n={4} title="Pick a model">
          <p>
            Browse{" "}
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              openrouter.ai/models
            </a>{" "}
            and choose a model that can <strong>see images</strong> (vision) and
            supports <strong>structured output</strong>. Good, cheap picks:
          </p>
          <ul className="list-disc pl-5">
            <li>
              <code className="rounded bg-muted px-1">openai/gpt-4o-mini</code>{" "}
              (reliable default)
            </li>
            <li>
              <code className="rounded bg-muted px-1">google/gemini-2.5-flash</code>{" "}
              (fast and inexpensive)
            </li>
          </ul>
          <p>
            👉 Copy the model id exactly as shown — it looks like{" "}
            <code className="rounded bg-muted px-1">vendor/model</code>.
          </p>
        </Step>

        <Step n={5} title="Paste it into Vividdit">
          <p>
            In Vividdit, go to <strong>Settings → Verification API key</strong>,
            paste your <code className="rounded bg-muted px-1">sk-or-…</code> key,
            and click <strong>Save key</strong>. Then open{" "}
            <strong>Advanced settings</strong> and set the model id from step 4
            (the default is <code className="rounded bg-muted px-1">openai/gpt-4o-mini</code>
            ). Finally click <strong>Test key</strong>.
          </p>
          <p>
            If it says <strong>Valid</strong>, you&apos;re done — your SoundCloud
            gates will verify fan screenshots with your chosen model. 🎉
          </p>
        </Step>
      </ol>

      <div className="mt-10 rounded-lg border p-4 text-sm">
        <p className="font-medium">Stuck on the &quot;Test&quot; step?</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          <li>
            <strong>Invalid key</strong> → make sure you copied the whole key
            (starts with <code className="rounded bg-muted px-1">sk-or-</code>)
            with no extra spaces.
          </li>
          <li>
            <strong>Model not found</strong> → the model id must match
            openrouter.ai/models exactly (e.g.{" "}
            <code className="rounded bg-muted px-1">openai/gpt-4o-mini</code>),
            and must be a vision model.
          </li>
          <li>
            <strong>Insufficient credits</strong> → add credit in step 2; a
            brand-new account with $0 balance can&apos;t make calls.
          </li>
        </ul>
      </div>

      <div className="mt-8">
        <Button render={<Link href="/dashboard/settings" />} nativeButton={false}>
          Back to Settings
        </Button>
      </div>
    </main>
  )
}
