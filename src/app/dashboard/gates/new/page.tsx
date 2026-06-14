import Link from "next/link"
import { redirect } from "next/navigation"

import { GateWizard } from "@/app/dashboard/gates/new/wizard"
import { hasValidOpenAiKey } from "@/lib/ai-keys"
import { FREE_GATE_LIMIT } from "@/lib/limits"
import { hasValidR2 } from "@/lib/storage"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
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

  const [{ data: profile }, keyValid, byor2, { count }] = await Promise.all([
    supabase
      .from("profiles")
      .select("artist_name, artist_slug")
      .eq("id", user.id)
      .single(),
    hasValidOpenAiKey(user.id),
    hasValidR2(user.id),
    supabase
      .from("gates")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id)
      .neq("status", "archived"),
  ])

  const atLimit = !byor2 && (count ?? 0) >= FREE_GATE_LIMIT

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Create a download gate
      </h1>
      {atLimit ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CardTitle>You&apos;ve used all {FREE_GATE_LIMIT} free gates</CardTitle>
            <CardDescription>
              Connect your own Cloudflare R2 storage to create unlimited gates —
              your files and fan downloads run on your bucket (no egress fees).
            </CardDescription>
            <Button render={<Link href="/dashboard/settings" />} nativeButton={false}>
              Connect storage in Settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <GateWizard
          artistSlug={profile?.artist_slug ?? ""}
          defaultArtist={profile?.artist_name ?? ""}
          hasValidKey={keyValid}
        />
      )}
    </div>
  )
}
