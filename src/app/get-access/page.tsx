import { redirect } from "next/navigation"

import { AccessForm } from "@/app/get-access/access-form"
import { AuthCard } from "@/components/auth-card"
import { CREATOR_INSTAGRAM_HANDLE } from "@/lib/creator-access-constants"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Get access" }

export default async function GetAccessPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("access_unlocked_at")
    .eq("id", user.id)
    .single()
  if (profile?.access_unlocked_at) redirect("/onboarding")

  return (
    <AuthCard
      title="One quick step to unlock Vividdit"
      description={`Vividdit is free — all I ask is a follow. Follow me, the creator, on Instagram (@${CREATOR_INSTAGRAM_HANDLE}) to unlock the tool.`}
    >
      <div className="space-y-5">
        <div className="space-y-2 rounded-lg border p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            This is also a quick tutorial 👇
          </p>
          <p>
            This is exactly how <strong>your</strong> download gates will work.
            Your fans do an action (follow, like, repost, or join your list),
            screenshot the proof, and AI verifies it automatically — unlocking
            the download. You&apos;re about to go through it yourself:
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Open my Instagram and tap <strong>Follow</strong>.</li>
            <li>Screenshot the profile showing <strong>“Following”</strong>.</li>
            <li>Upload it — AI checks it in seconds and lets you in.</li>
          </ol>
        </div>

        <AccessForm />
      </div>
    </AuthCard>
  )
}
