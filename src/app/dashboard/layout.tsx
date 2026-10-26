import { TriangleAlert } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { logout } from "@/app/(auth)/actions"
import { DashboardNav } from "@/app/dashboard/nav"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { getAiKeyInfo } from "@/lib/ai-keys"
import { getEmailKeyInfo } from "@/lib/email-keys"
import { createClient } from "@/lib/supabase/server"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("artist_name, artist_slug, soundcloud_profile_url, access_unlocked_at")
    .eq("id", user.id)
    .single()

  if (!profile?.access_unlocked_at) {
    redirect("/get-access")
  }

  const complete =
    !!profile?.artist_name &&
    !!profile?.artist_slug &&
    !!profile?.soundcloud_profile_url
  if (!complete) {
    redirect("/onboarding")
  }

  // The things that silently cost downloads: a review queue nobody sees and a
  // key that stopped working.
  const [{ count: reviewCount }, { count: verifiedGates }, aiKey, emailKey] =
    await Promise.all([
      supabase
        .from("submissions")
        .select("id, gates!inner(creator_id)", { count: "exact", head: true })
        .eq("status", "needs_review")
        .eq("gates.creator_id", user.id),
      supabase
        .from("gates")
        .select("id, gate_requirements!inner(unlock_mode)", {
          count: "exact",
          head: true,
        })
        .eq("creator_id", user.id)
        .eq("status", "published")
        .eq("gate_requirements.unlock_mode", "verified"),
      getAiKeyInfo(user.id),
      getEmailKeyInfo(user.id),
    ])

  const alerts: { title: string; body: string }[] = []
  if ((verifiedGates ?? 0) > 0 && (!aiKey || aiKey.keyStatus === "invalid")) {
    alerts.push({
      title: "Screenshot checks are off",
      body: `${
        aiKey ? (aiKey.lastError ?? "Your AI key failed its check.") : "You have no AI key saved."
      } Fans on your ${verifiedGates} Verified gate${
        verifiedGates === 1 ? "" : "s"
      } still get their download, but nobody checks their screenshots.`,
    })
  }
  if (emailKey?.keyStatus === "invalid") {
    alerts.push({
      title: "Download emails aren't sending",
      body: `${emailKey.lastError ?? "Your Resend key failed its check."} Fans still get the download on the page.`,
    })
  }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b p-4 md:w-60 md:border-r md:border-b-0">
        <Link href="/dashboard" className="px-3 pt-2">
          <span className="text-sm font-semibold tracking-widest uppercase">
            Vividdit
          </span>
        </Link>
        <DashboardNav reviewCount={reviewCount ?? 0} />
        <div className="mt-auto hidden md:block">
          <Separator className="mb-3" />
          <div className="space-y-2 px-3 pb-2">
            <p className="truncate text-xs text-muted-foreground" title={user.email ?? ""}>
              {profile?.artist_name} · {user.email}
            </p>
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm" className="w-full">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-10">
        {alerts.length > 0 && (
          <div className="mb-6 max-w-3xl space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.title}
                role="alert"
                className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-destructive">{alert.title}</p>
                  <p className="text-muted-foreground">{alert.body}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href="/dashboard/settings" />}
                  nativeButton={false}
                >
                  Fix in Settings
                </Button>
              </div>
            ))}
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
