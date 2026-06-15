import { redirect } from "next/navigation"

import { OpenAiKeySection } from "@/app/dashboard/settings/openai-key-section"
import { ProfileSection } from "@/app/dashboard/settings/profile-section"
import { ResendKeySection } from "@/app/dashboard/settings/resend-key-section"
import { StorageSection } from "@/app/dashboard/settings/storage-section"
import { Separator } from "@/components/ui/separator"
import { getAiKeyInfo } from "@/lib/ai-keys"
import { getEmailKeyInfo } from "@/lib/email-keys"
import { FREE_GATE_LIMIT } from "@/lib/limits"
import { getR2Info } from "@/lib/storage"
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

  const [{ data: profile }, keyInfo, emailKeyInfo, r2Info] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "artist_name, artist_slug, soundcloud_profile_url, instagram_url, spotify_url"
      )
      .eq("id", user.id)
      .single(),
    getAiKeyInfo(user.id),
    getEmailKeyInfo(user.id),
    getR2Info(user.id),
  ])

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <ProfileSection
        profile={{
          artistName: profile?.artist_name ?? "",
          artistSlug: profile?.artist_slug ?? "",
          soundcloudProfileUrl: profile?.soundcloud_profile_url ?? "",
          instagramUrl: profile?.instagram_url ?? "",
          spotifyUrl: profile?.spotify_url ?? "",
        }}
      />
      <Separator />
      <OpenAiKeySection keyInfo={keyInfo} />
      <Separator />
      <StorageSection info={r2Info} freeGateLimit={FREE_GATE_LIMIT} />
      <Separator />
      <ResendKeySection keyInfo={emailKeyInfo} />
    </div>
  )
}
