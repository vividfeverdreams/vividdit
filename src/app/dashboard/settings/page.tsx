import { redirect } from "next/navigation"

import { OpenAiKeySection } from "@/app/dashboard/settings/openai-key-section"
import { ProfileSection } from "@/app/dashboard/settings/profile-section"
import { Separator } from "@/components/ui/separator"
import { getAiKeyInfo, VERIFICATION_MODELS } from "@/lib/ai-keys"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Settings" }

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  const [{ data: profile }, keyInfo] = await Promise.all([
    supabase
      .from("profiles")
      .select("artist_name, artist_slug, soundcloud_profile_url")
      .eq("id", user.id)
      .single(),
    getAiKeyInfo(user.id),
  ])

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <ProfileSection
        profile={{
          artistName: profile?.artist_name ?? "",
          artistSlug: profile?.artist_slug ?? "",
          soundcloudProfileUrl: profile?.soundcloud_profile_url ?? "",
        }}
      />
      <Separator />
      <OpenAiKeySection keyInfo={keyInfo} models={VERIFICATION_MODELS} />
    </div>
  )
}
