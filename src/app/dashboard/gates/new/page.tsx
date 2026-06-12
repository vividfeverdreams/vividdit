import { redirect } from "next/navigation"

import { GateWizard } from "@/app/dashboard/gates/new/wizard"
import { hasValidOpenAiKey } from "@/lib/ai-keys"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "New gate" }

export default async function NewGatePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  const [{ data: profile }, keyValid] = await Promise.all([
    supabase
      .from("profiles")
      .select("artist_name, artist_slug")
      .eq("id", user.id)
      .single(),
    hasValidOpenAiKey(user.id),
  ])

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Create a download gate
      </h1>
      <GateWizard
        artistSlug={profile?.artist_slug ?? ""}
        defaultArtist={profile?.artist_name ?? ""}
        hasValidKey={keyValid}
      />
    </div>
  )
}
