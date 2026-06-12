import Link from "next/link"
import { redirect } from "next/navigation"

import { logout } from "@/app/(auth)/actions"
import { DashboardNav } from "@/app/dashboard/nav"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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
    .select("artist_name, artist_slug, soundcloud_profile_url")
    .eq("id", user.id)
    .single()

  const complete =
    !!profile?.artist_name &&
    !!profile?.artist_slug &&
    !!profile?.soundcloud_profile_url
  if (!complete) {
    redirect("/onboarding")
  }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b p-4 md:w-60 md:border-r md:border-b-0">
        <Link href="/dashboard" className="px-3 pt-2">
          <span className="text-sm font-semibold tracking-widest uppercase">
            Vividdit
          </span>
        </Link>
        <DashboardNav />
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
      <main className="flex-1 p-6 md:p-10">{children}</main>
    </div>
  )
}
