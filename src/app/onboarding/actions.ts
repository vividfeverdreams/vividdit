"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { onboardingSchema } from "@/lib/validation"

export type OnboardingFormState = {
  error: string | null
}

export async function completeOnboarding(
  _prevState: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  const parsed = onboardingSchema.safeParse({
    artistName: formData.get("artistName"),
    artistSlug: formData.get("artistSlug"),
    soundcloudProfileUrl: formData.get("soundcloudProfileUrl"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("artist_slug")
    .eq("id", user.id)
    .single()

  // artist_slug is immutable (DB trigger). Only send it when unset.
  const update: Record<string, string> = {
    artist_name: parsed.data.artistName,
    soundcloud_profile_url: parsed.data.soundcloudProfileUrl,
  }
  if (!profile?.artist_slug) {
    update.artist_slug = parsed.data.artistSlug
  } else if (profile.artist_slug !== parsed.data.artistSlug) {
    return { error: "Your artist URL is already set and can't be changed." }
  }

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id)

  if (error) {
    if (error.code === "23505") {
      return { error: "That artist URL is taken — try another." }
    }
    return { error: "Couldn't save your profile. Please try again." }
  }

  redirect("/dashboard")
}
