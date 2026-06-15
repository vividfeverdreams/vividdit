import Link from "next/link"

import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Get your OpenAI API key",
  description:
    "Step-by-step guide to creating an OpenAI API key so Vividdit can verify fan proof screenshots for your download gates.",
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

export default function OpenAiApiKeyGuide() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link
        href="/"
        className="text-sm font-medium tracking-widest uppercase text-muted-foreground"
      >
        Vividdit
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Get your OpenAI API key
      </h1>
      <p className="mt-2 text-muted-foreground">
        Vividdit uses AI to check the screenshots fans upload as proof they
        followed, liked, or reposted — so you don&apos;t have to review them by
        hand. That check runs on <strong>your</strong> OpenAI key, which is how
        Vividdit stays free. This takes about 5 minutes — no technical
        experience needed. Follow each step.
      </p>

      <div className="mt-6 rounded-lg border bg-muted/50 p-4 text-sm">
        <p className="font-medium">
          By the end you&apos;ll have one value to paste into Vividdit:
        </p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          <li>
            A secret API key that starts with{" "}
            <code className="rounded bg-muted px-1">sk-</code>
          </li>
        </ul>
      </div>

      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
        <p className="font-medium">What does it cost?</p>
        <p className="mt-1 text-muted-foreground">
          Almost nothing. Verifying one fan&apos;s screenshots costs a fraction
          of a cent, and OpenAI gives you pay-as-you-go pricing — you only pay
          for what you use. Most artists add <strong>$5</strong> once and it
          lasts a very long time. You can set a hard spending limit so you&apos;re
          never surprised.
        </p>
      </div>

      <ol className="mt-8 space-y-8">
        <Step n={1} title="Create an OpenAI account">
          <p>
            Go to{" "}
            <a
              href="https://platform.openai.com/signup"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              platform.openai.com/signup
            </a>{" "}
            and sign up (or log in if you already have one). This is the
            developer platform — it&apos;s separate from a ChatGPT Plus
            subscription, and a Plus subscription does <strong>not</strong>{" "}
            include API access.
          </p>
        </Step>

        <Step n={2} title="Add a little billing credit">
          <p>
            The API needs a small prepaid balance to work. Go to{" "}
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              Settings → Billing
            </a>
            , click <strong>Add payment details</strong>, and add{" "}
            <strong>$5</strong> (the minimum). That&apos;s plenty to verify
            hundreds of fans.
          </p>
          <p>
            👉 While you&apos;re there, you can set a{" "}
            <strong>monthly budget limit</strong> (e.g. $5) so spending can
            never run away.
          </p>
        </Step>

        <Step n={3} title="Open the API keys page">
          <p>
            Go to{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              platform.openai.com/api-keys
            </a>
            . This is where your secret keys live.
          </p>
        </Step>

        <Step n={4} title="Create a new secret key">
          <p>
            Click <strong>Create new secret key</strong>. Give it a name like{" "}
            <code className="rounded bg-muted px-1">vividdit</code>, leave the
            other options as their defaults, and click{" "}
            <strong>Create secret key</strong>.
          </p>
          <p>
            OpenAI now shows a long key that starts with{" "}
            <code className="rounded bg-muted px-1">sk-</code>.{" "}
            <strong>Copy it now — it&apos;s only shown once.</strong> If you lose
            it, just delete it and make a new one.
          </p>
          <p>
            👉 That&apos;s your <strong>OpenAI API key</strong> for Vividdit.
          </p>
        </Step>

        <Step n={5} title="Paste it into Vividdit">
          <p>
            In Vividdit, go to <strong>Settings → OpenAI API key</strong>, paste
            the key into the box, and click <strong>Save key</strong>. Then click{" "}
            <strong>Test key</strong>.
          </p>
          <p>
            If it says <strong>Valid</strong>, you&apos;re done — your SoundCloud
            gates can now verify fan screenshots automatically. 🎉
          </p>
        </Step>
      </ol>

      <div className="mt-10 rounded-lg border p-4 text-sm">
        <p className="font-medium">Stuck on the &quot;Test&quot; step?</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          <li>
            <strong>Invalid key</strong> → make sure you copied the whole key
            (starts with <code className="rounded bg-muted px-1">sk-</code>) with
            no extra spaces. If unsure, delete it on OpenAI and create a fresh
            one.
          </li>
          <li>
            <strong>Quota / billing error</strong> → add the $5 credit in step 2.
            A brand-new account with no balance can&apos;t use the API yet.
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
