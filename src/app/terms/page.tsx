import Link from "next/link"

export const metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Vividdit.",
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

export default function TermsOfService() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link
        href="/"
        className="text-sm font-medium tracking-widest uppercase text-muted-foreground"
      >
        Vividdit
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="mt-8 space-y-8">
        <Section title="1. Acceptance">
          <p>
            By creating an account or using Vividdit (the &quot;Service&quot;),
            you agree to these Terms. If you don&apos;t agree, don&apos;t use the
            Service.
          </p>
        </Section>

        <Section title="2. The Service">
          <p>
            Vividdit is a free tool that lets creators publish &quot;download
            gates&quot; — fans complete an action (follow, like, repost, or email
            signup) to unlock a creator&apos;s file. The Service relies on keys
            and storage that you bring yourself (&quot;bring your own key&quot;).
            We may change or discontinue features at any time.
          </p>
        </Section>

        <Section title="3. Accounts">
          <p>
            You&apos;re responsible for your account and for keeping your login
            credentials secure. You must provide accurate information and be old
            enough to form a binding contract in your jurisdiction.
          </p>
        </Section>

        <Section title="4. Your content and your fans&apos; data">
          <p>
            You must own or have the rights to any files you distribute through a
            gate. You are the controller of the personal data your fans submit
            through your gates (such as their email addresses), and you are
            responsible for handling it lawfully — including providing any notices
            and honoring any rights your fans have. Vividdit processes that data on
            your behalf to operate the Service.
          </p>
        </Section>

        <Section title="5. Third-party platform rules">
          <p>
            SoundCloud, Instagram, Spotify, and other platforms each have their
            own terms, some of which restrict incentivizing follows, likes, or
            reposts in exchange for downloads. You are solely responsible for
            ensuring your use of the Service complies with those platforms&apos;
            terms. Vividdit is not affiliated with, endorsed by, or sponsored by
            SoundCloud, Instagram, or Spotify. You use the Service at your own
            risk with respect to those platforms&apos; rules.
          </p>
        </Section>

        <Section title="6. Your API keys and third-party services">
          <p>
            You are responsible for any API keys and third-party accounts you
            connect (e.g. OpenAI, OpenRouter, Resend, Cloudflare), for any costs
            they incur, and for complying with those providers&apos; terms. We
            encrypt your keys at rest but are not responsible for charges on your
            accounts.
          </p>
        </Section>

        <Section title="7. Acceptable use">
          <p>
            Don&apos;t use the Service to distribute unlawful, infringing, or
            harmful content; to violate others&apos; rights; to send spam; or to
            interfere with or attempt to breach the Service&apos;s security. We may
            suspend or remove accounts or content that violate these Terms.
          </p>
        </Section>

        <Section title="8. Disclaimer of warranties">
          <p>
            THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
            AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
            INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT. We do not warrant that the Service will be
            uninterrupted, secure, or error-free, or that AI proof verification
            will be accurate.
          </p>
        </Section>

        <Section title="9. Limitation of liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, VIVIDDIT AND ITS OPERATOR WILL
            NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, OR GOODWILL. BECAUSE THE
            SERVICE IS PROVIDED FREE OF CHARGE, OUR TOTAL AGGREGATE LIABILITY FOR
            ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED ONE HUNDRED U.S.
            DOLLARS ($100). Some jurisdictions don&apos;t allow certain
            limitations, so some of the above may not apply to you. Nothing in
            these Terms limits liability that cannot be limited by law.
          </p>
        </Section>

        <Section title="10. Indemnification">
          <p>
            You agree to indemnify and hold Vividdit and its operator harmless from
            claims arising out of your content, your use of the Service, your
            handling of your fans&apos; data, or your violation of these Terms or
            of any third-party platform&apos;s rules.
          </p>
        </Section>

        <Section title="11. Termination">
          <p>
            You may stop using the Service and delete your account at any time. We
            may suspend or terminate access if you violate these Terms or to
            protect the Service.
          </p>
        </Section>

        <Section title="12. Changes">
          <p>
            We may update these Terms; we&apos;ll revise the date above when we do.
            Continued use after changes means you accept them.
          </p>
        </Section>

        <Section title="13. Governing law">
          <p>
            These Terms are governed by the laws of the operator&apos;s principal
            place of business, without regard to conflict-of-laws rules. (Operator
            to confirm governing jurisdiction.)
          </p>
        </Section>

        <Section title="14. Contact">
          <p>Questions: {CONTACT}.</p>
        </Section>

        <p className="border-t pt-6 text-xs text-muted-foreground">
          See also our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
