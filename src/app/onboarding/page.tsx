import { redirect } from "next/navigation"

import { OnboardingForm } from "@/app/onboarding/onboarding-form"
import { AuthCard } from "@/components/auth-card"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Set up your profile" }

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("artist_name, artist_slug, soundcloud_profile_url")
    .eq("id", user.id)
    .single()

  const complete =
    !!profile?.artist_name &&
    !!profile?.artist_slug &&
    !!profile?.soundcloud_profile_url
  if (complete) {
    redirect("/dashboard")
  }

  return (
    <AuthCard
      title="Set up your artist profile"
      description="This is how fans see you on your gate pages."
    >
      <OnboardingForm
        defaults={{
          artistName: profile?.artist_name ?? "",
          artistSlug: profile?.artist_slug ?? "",
          soundcloudProfileUrl: profile?.soundcloud_profile_url ?? "",
          slugLocked: !!profile?.artist_slug,
        }}
      />
    </AuthCard>
  )
}
