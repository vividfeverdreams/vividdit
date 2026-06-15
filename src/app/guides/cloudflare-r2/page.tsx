import Link from "next/link"

import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Connect Cloudflare R2 storage",
  description:
    "Step-by-step guide to creating a Cloudflare R2 bucket and API key for your Vividdit download gates.",
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

const CORS_JSON = `[
  {
    "AllowedOrigins": ["https://vividdit.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]`

export default function CloudflareR2Guide() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link
        href="/"
        className="text-sm font-medium tracking-widest uppercase text-muted-foreground"
      >
        Vividdit
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Connect Cloudflare R2 storage
      </h1>
      <p className="mt-2 text-muted-foreground">
        Connecting your own storage gives you <strong>unlimited gates</strong>,
        and because Cloudflare R2 has <strong>no egress (download) fees</strong>,
        it stays free or near-free even when your tracks blow up. This takes
        about 5–10 minutes — no technical experience needed. Follow each step.
      </p>

      <div className="mt-6 rounded-lg border bg-muted/50 p-4 text-sm">
        <p className="font-medium">By the end you&apos;ll have 4 values to paste into Vividdit:</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          <li>Account ID</li>
          <li>Bucket name</li>
          <li>Access Key ID</li>
          <li>Secret Access Key</li>
        </ul>
      </div>

      <ol className="mt-8 space-y-8">
        <Step n={1} title="Create a free Cloudflare account">
          <p>
            Go to{" "}
            <a
              href="https://dash.cloudflare.com/sign-up"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              dash.cloudflare.com/sign-up
            </a>{" "}
            and sign up (or log in if you already have one). It&apos;s free.
          </p>
        </Step>

        <Step n={2} title="Open R2 and enable it">
          <p>
            In the left sidebar, click <strong>R2 Object Storage</strong>. The
            first time, Cloudflare asks you to add a payment method to activate
            R2 — this is required even though R2&apos;s free tier (10 GB storage,
            no egress fees) covers most artists. You won&apos;t be charged unless
            you exceed the free tier.
          </p>
        </Step>

        <Step n={3} title="Create a bucket">
          <p>
            Click <strong>Create bucket</strong>. Give it a name like{" "}
            <code className="rounded bg-muted px-1">vividdit-downloads</code>{" "}
            (lowercase, no spaces), leave the defaults, and click{" "}
            <strong>Create bucket</strong>.
          </p>
          <p>
            👉 That name is your <strong>Bucket name</strong> for Vividdit.
          </p>
        </Step>

        <Step n={4} title="Copy your Account ID">
          <p>
            On the R2 overview page, look on the right side for{" "}
            <strong>Account details</strong> → <strong>Account ID</strong> (a
            long string of letters and numbers). Click to copy it.
          </p>
          <p>
            👉 That&apos;s your <strong>Account ID</strong> for Vividdit.
          </p>
        </Step>

        <Step n={5} title="Create an R2 API token">
          <p>
            On the R2 page, click <strong>Manage R2 API Tokens</strong> (top
            right), then <strong>Create API token</strong>.
          </p>
          <ul className="list-disc pl-5">
            <li>
              Name it anything (e.g. <code className="rounded bg-muted px-1">vividdit</code>).
            </li>
            <li>
              Permission: choose <strong>Admin Read &amp; Write</strong>. This
              lets Vividdit set up uploads for you automatically — so you can
              skip the CORS step entirely.
            </li>
            <li>
              Scope: apply it to <strong>just the bucket you made</strong>
              (recommended) or all buckets — either works.
            </li>
            <li>Leave the other options as default and create the token.</li>
          </ul>
          <p>
            Cloudflare now shows an <strong>Access Key ID</strong> and a{" "}
            <strong>Secret Access Key</strong>.{" "}
            <strong>
              Copy the Secret Access Key now — it&apos;s only shown once.
            </strong>
          </p>
          <p>
            👉 Those are your <strong>Access Key ID</strong> and{" "}
            <strong>Secret Access Key</strong> for Vividdit. (Ignore the
            &quot;S3 endpoint&quot; URL — Vividdit builds that from your Account ID.)
          </p>
        </Step>

        <Step n={6} title="Uploads (CORS) — handled automatically ✨">
          <p>
            Good news: if you used an <strong>Admin Read &amp; Write</strong>{" "}
            token in step 5, you can <strong>skip this</strong> — Vividdit sets
            the upload permissions (CORS) for you automatically when you click
            Test in the next step.
          </p>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">
              Only if you used a least-privilege &quot;Object&quot; token: set CORS manually
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Open your bucket → <strong>Settings</strong> →{" "}
                <strong>CORS policy</strong> → <strong>Add</strong>, paste this
                exactly, and save:
              </p>
              <pre className="overflow-x-auto rounded-lg border bg-muted p-3 text-xs text-foreground">
                {CORS_JSON}
              </pre>
              <p>
                If Cloudflare shows &quot;An error occurred&quot;: the origin must
                be exactly{" "}
                <code className="rounded bg-muted px-1">https://vividdit.com</code>{" "}
                (no trailing slash), quotes must be straight, and the panel is
                occasionally flaky — hard-refresh and retry.
              </p>
            </div>
          </details>
        </Step>

        <Step n={7} title="Paste it all into Vividdit">
          <p>
            In Vividdit, go to <strong>Settings → Storage (Cloudflare R2)</strong>,
            click <strong>Connect R2</strong>, and fill in:
          </p>
          <ul className="list-disc pl-5">
            <li>Account ID → from step 4</li>
            <li>Bucket name → from step 3</li>
            <li>Access Key ID → from step 5</li>
            <li>Secret Access Key → from step 5</li>
            <li>Public domain → leave blank (optional, advanced)</li>
          </ul>
          <p>
            Click <strong>Save</strong>, then <strong>Test</strong>. Vividdit
            checks your bucket and automatically configures uploads. If it says{" "}
            <strong>Connected</strong>, you&apos;re done — unlimited gates on your
            own storage. 🎉
          </p>
        </Step>
      </ol>

      <div className="mt-10 rounded-lg border p-4 text-sm">
        <p className="font-medium">Stuck on the &quot;Test&quot; step?</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          <li>
            <strong>Access denied</strong> → double-check the Access Key ID and
            Secret, and that the token has Object Read &amp; Write.
          </li>
          <li>
            <strong>Bucket not found</strong> → re-check the bucket name and
            Account ID for typos.
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
