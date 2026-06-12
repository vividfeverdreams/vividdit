import Link from "next/link"

import { publishGate, setGateArchived } from "@/app/dashboard/actions"
import { CopyUrlButton } from "@/app/dashboard/copy-url-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Download Gates" }

function StatusBadge({ status }: { status: string }) {
  if (status === "published") return <Badge>Published</Badge>
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>
  return <Badge variant="outline">Draft</Badge>
}

export default async function GatesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // RLS also lets authenticated users read other creators' *published* gates
  // (fan pages need that), so scope explicitly to the signed-in creator.
  const [{ data: gates }, { data: profile }] = await Promise.all([
    supabase
      .from("gates")
      .select("id, title, artist, slug, status, created_at")
      .eq("creator_id", user!.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("artist_slug")
      .eq("id", user!.id)
      .single(),
  ])

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vividdit.com"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Download Gates
        </h1>
        <Button render={<Link href="/dashboard/gates/new" />} nativeButton={false}>
          New gate
        </Button>
      </div>

      {!gates?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="space-y-2">
              <CardTitle>No gates yet</CardTitle>
              <CardDescription>
                Create your first download gate to start turning free downloads
                into followers.
              </CardDescription>
            </div>
            <Button
              render={<Link href="/dashboard/gates/new" />}
              nativeButton={false}
            >
              Create your first gate
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {gates.map((g) => {
            const publicUrl = `${siteUrl}/${profile?.artist_slug}/${g.slug}`
            return (
              <li key={g.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-3 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {g.artist} · /{profile?.artist_slug}/{g.slug}
                      </p>
                    </div>
                    <StatusBadge status={g.status} />
                    <div className="flex gap-2">
                      {g.status === "published" && (
                        <CopyUrlButton url={publicUrl} />
                      )}
                      {g.status === "draft" && (
                        <form action={publishGate}>
                          <input type="hidden" name="gateId" value={g.id} />
                          <Button size="sm" type="submit">
                            Publish
                          </Button>
                        </form>
                      )}
                      <form action={setGateArchived}>
                        <input type="hidden" name="gateId" value={g.id} />
                        <input
                          type="hidden"
                          name="archive"
                          value={g.status === "archived" ? "false" : "true"}
                        />
                        <Button size="sm" variant="ghost" type="submit">
                          {g.status === "archived" ? "Restore" : "Archive"}
                        </Button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
