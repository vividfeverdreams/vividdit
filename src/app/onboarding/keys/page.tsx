import Link from "next/link"
import { redirect } from "next/navigation"

import { OpenAiKeySection } from "@/app/dashboard/settings/openai-key-section"
import { ResendKeySection } from "@/app/dashboard/settings/resend-key-section"
import { StorageSection } from "@/app/dashboard/settings/storage-section"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { getAiKeyInfo } from "@/lib/ai-keys"
import { getEmailKeyInfo } from "@/lib/email-keys"
import { FREE_GATE_LIMIT } from "@/lib/limits"
import { getR2Info } from "@/lib/storage"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Connect your keys" }

function HowTo({ title, steps, caveat }: { title: string; steps: string; caveat: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      <p>{steps}</p>
      <p className="mt-1">
        <span className="font-medium">Without it:</span> {caveat}
      </p>
    </div>
  )
}

export default async function OnboardingKeysPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("artist_name, artist_slug, soundcloud_profile_url, access_unlocked_at")
    .eq("id", user.id)
    .single()

  if (!profile?.access_unlocked_at) redirect("/get-access")
  const complete =
    !!profile.artist_name && !!profile.artist_slug && !!profile.soundcloud_profile_url
  if (!complete) redirect("/onboarding")

  const [keyInfo, emailKeyInfo, r2Info] = await Promise.all([
    getAiKeyInfo(user.id),
    getEmailKeyInfo(user.id),
    getR2Info(user.id),
  ])

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <div className="space-y-2 text-center">
        <p className="text-sm font-medium tracking-widest uppercase text-muted-foreground">
          Vividdit
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect your keys (optional)
        </h1>
        <p className="text-sm text-muted-foreground">
          Vividdit is free because each artist brings their own API keys — so the
          platform&apos;s costs stay near zero. You can add these now or anytime
          in Settings; here&apos;s what each unlocks.
        </p>
      </div>

      <div className="mt-8 space-y-8">
        <div className="space-y-3">
          <HowTo
            title="AI key (OpenAI or OpenRouter) — verifies fan screenshots"
            steps="New to OpenAI? Use the step-by-step setup guide linked in the section below (about $5, lasts a long time). Prefer a different model? Paste an OpenRouter key (sk-or-…) instead to use Gemini, Claude, GPT, and more."
            caveat="you can't publish gates that need follow/like/repost verification. Email-only gates still work."
          />
          <OpenAiKeySection keyInfo={keyInfo} />
        </div>

        <Separator />

        <div className="space-y-3">
          <HowTo
            title="Cloudflare R2 — your own storage for HQ files"
            steps="New to Cloudflare? Use the step-by-step setup guide linked in the section below — it walks through every value."
            caveat={`you're limited to ${FREE_GATE_LIMIT} active gates on Vividdit's storage. Connect R2 for unlimited.`}
          />
          <StorageSection info={r2Info} freeGateLimit={FREE_GATE_LIMIT} />
        </div>

        <Separator />

        <div className="space-y-3">
          <HowTo
            title="Resend key — emails fans their download links"
            steps="Get it at resend.com → API Keys → Create. Verify your domain to email any fan (sandbox only emails your own address)."
            caveat="fans won't get emailed their download link or review updates — they'll still download from their status page."
          />
          <ResendKeySection keyInfo={emailKeyInfo} />
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center gap-2">
        <Button render={<Link href="/dashboard" />} nativeButton={false} size="lg">
          Continue to dashboard
        </Button>
        <p className="text-xs text-muted-foreground">
          You can add or change these anytime in Settings.
        </p>
      </div>
    </main>
  )
}
