import Link from "next/link"

export const metadata = {
  title: "Privacy Policy",
  description: "How Vividdit collects, uses, and protects personal data.",
}

const UPDATED = "June 17, 2026"
const CONTACT = "vividfeverdreams@gmail.com"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  )
}

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link
        href="/"
        className="text-sm font-medium tracking-widest uppercase text-muted-foreground"
      >
        Vividdit
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="mt-8 space-y-8">
        <Section title="Who we are">
          <p>
            Vividdit (&quot;Vividdit,&quot; &quot;we,&quot; &quot;us&quot;) is a
            free tool that lets musicians (&quot;creators&quot;) offer download
            gates: a fan completes an action (follow, like, repost, or email
            signup) to unlock a creator&apos;s file. This policy explains what
            personal data we handle and how. Questions: {CONTACT}.
          </p>
          <p>
            For data that fans provide on a creator&apos;s gate, the{" "}
            <strong>creator is the controller</strong> of that data and Vividdit
            acts as a <strong>processor</strong> on their behalf. For creator
            accounts, Vividdit is the controller.
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Creator accounts:</strong> email address and authentication
              data (managed by our auth provider), and your artist profile (name,
              URL slug, and the SoundCloud/Instagram/Spotify links you add).
            </li>
            <li>
              <strong>Your API keys</strong> (OpenAI/OpenRouter, Resend,
              Cloudflare R2), which you optionally provide. These are{" "}
              <strong>encrypted at rest</strong> and never shown back to the
              browser.
            </li>
            <li>
              <strong>Fan submissions:</strong> an email address (only if the gate
              asks for one and the fan provides it), the proof screenshots a fan
              uploads, and an optional proof code.
            </li>
            <li>
              <strong>Usage events:</strong> gate views, unlocks, and downloads,
              plus basic referral/UTM parameters, used for the creator&apos;s
              analytics.
            </li>
            <li>
              <strong>Optional ad pixels:</strong> if a creator enables Facebook,
              Google, or TikTok pixels on their gate, those third parties may set
              cookies and collect data once a visitor accepts the consent notice.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <p>
            To operate the service: authenticate creators, run gates, verify fan
            proof screenshots with AI, deliver downloads, send creators&apos; fan
            emails, and provide analytics. We do not sell personal data.
          </p>
        </Section>

        <Section title="Who we share it with (sub-processors)">
          <p>We rely on these providers to run the service:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Vercel</strong> — hosting and content delivery.
            </li>
            <li>
              <strong>Supabase</strong> — database, authentication, and file
              storage.
            </li>
            <li>
              <strong>OpenAI / OpenRouter</strong> — proof screenshots are sent to
              the AI provider configured by the creator to verify the required
              action. Governed by that provider&apos;s terms.
            </li>
            <li>
              <strong>Resend</strong> — sending creators&apos; fan emails (using
              the creator&apos;s own key when configured).
            </li>
            <li>
              <strong>Cloudflare R2</strong> — file storage when a creator connects
              their own bucket.
            </li>
            <li>
              <strong>Facebook / Google / TikTok</strong> — only if a creator
              enables ad pixels on their gate, and only after visitor consent.
            </li>
          </ul>
        </Section>

        <Section title="How we protect it">
          <p>
            Creator API keys are encrypted at rest using AES-256-GCM, with the
            encryption secret held only in our server environment. Database access
            is restricted with row-level security so creators can only reach their
            own data, and the tables holding secrets are reachable only by trusted
            server code. All traffic is served over HTTPS. No system is perfectly
            secure, but we take reasonable measures to protect your information.
          </p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Proof screenshots</strong> are automatically deleted about{" "}
              <strong>30 days</strong> after a submission is approved or rejected.
            </li>
            <li>
              <strong>Fan emails</strong> that a fan provides to join a
              creator&apos;s list are retained for the creator until the creator
              removes them or deletes the gate. Emails used only to deliver a
              one-time download are minimized after they&apos;re no longer needed.
            </li>
            <li>
              <strong>Creator accounts and data</strong> are kept until the account
              is deleted.
            </li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>
            Depending on where you live (e.g. the EU/UK under GDPR or California
            under the CCPA/CPRA), you may have the right to access, correct,
            delete, or export your personal data, and to opt out of certain
            processing. Fans should contact the creator whose gate they used;
            creators and anyone else can contact us at {CONTACT} and we&apos;ll
            respond as required by law.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Vividdit is not directed to children under 13 (or the minimum age in
            your country), and we don&apos;t knowingly collect their data.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update this policy; we&apos;ll revise the date above when we do.
            Material changes will be reflected here.
          </p>
        </Section>

        <Section title="Contact">
          <p>Questions or requests: {CONTACT}.</p>
        </Section>

        <p className="border-t pt-6 text-xs text-muted-foreground">
          This page is provided for transparency and is not legal advice. See our{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
