import Link from "next/link"

import { publishGate, setGateArchived } from "@/app/dashboard/actions"
import { CopyUrlButton } from "@/app/dashboard/copy-url-button"
import { SortSelect } from "@/app/dashboard/sort-select"
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

const SORTS = ["newest", "oldest", "visits", "downloads", "archived"] as const
type Sort = (typeof SORTS)[number]

function StatusBadge({ status }: { status: string }) {
  if (status === "published") return <Badge>Published</Badge>
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>
  return <Badge variant="outline">Draft</Badge>
}

function coverUrl(g: {
  cover_path: string | null
  theme: { artworkUrl?: string | null } | null
}): string | null {
  if (g.cover_path) {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/${g.cover_path}`
  }
  return g.theme?.artworkUrl ?? null
}

export default async function GatesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const sp = await searchParams
  const sort: Sort = SORTS.includes(sp.sort as Sort) ? (sp.sort as Sort) : "newest"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: gatesRaw }, { data: profile }, { data: stats }] =
    await Promise.all([
      supabase
        .from("gates")
        .select("id, title, artist, slug, status, created_at, cover_path, theme")
        .eq("creator_id", user!.id),
      supabase.from("profiles").select("artist_slug").eq("id", user!.id).single(),
      supabase.from("gate_stats").select("gate_id, views, downloads, emails"),
    ])

  const statById = new Map(
    (stats ?? []).map((s) => [
      s.gate_id,
      {
        views: Number(s.views ?? 0),
        downloads: Number(s.downloads ?? 0),
        emails: Number(s.emails ?? 0),
      },
    ])
  )
  const statFor = (id: string) =>
    statById.get(id) ?? { views: 0, downloads: 0, emails: 0 }

  const all = (gatesRaw ?? []).map((g) => ({ ...g, stat: statFor(g.id) }))

  // "archived" is a filter; the rest are sorts over non-archived gates.
  const gates =
    sort === "archived"
      ? all.filter((g) => g.status === "archived")
      : all.filter((g) => g.status !== "archived")

  gates.sort((a, b) => {
    if (sort === "visits") return b.stat.views - a.stat.views
    if (sort === "downloads") return b.stat.downloads - a.stat.downloads
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    return sort === "oldest" ? ta - tb : tb - ta
  })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vividdit.com"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Download Gates</h1>
        <Button render={<Link href="/dashboard/gates/new" />} nativeButton={false}>
          New gate
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort</span>
        <SortSelect value={sort} />
      </div>

      {!gates.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="space-y-2">
              <CardTitle>
                {sort === "archived" ? "No archived gates" : "No gates yet"}
              </CardTitle>
              <CardDescription>
                {sort === "archived"
                  ? "Gates you archive will show up here."
                  : "Create your first download gate to start turning free downloads into followers."}
              </CardDescription>
            </div>
            {sort !== "archived" && (
              <Button
                render={<Link href="/dashboard/gates/new" />}
                nativeButton={false}
              >
                Create your first gate
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {gates.map((g) => {
            const publicUrl = `${siteUrl}/${profile?.artist_slug}/${g.slug}`
            const cover = coverUrl(g)
            return (
              <li key={g.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4 py-4">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt=""
                        className="size-14 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="size-14 shrink-0 rounded-md bg-muted" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {g.artist} · /{profile?.artist_slug}/{g.slug}
                      </p>
                    </div>

                    <div className="flex gap-5 text-center text-sm">
                      <div>
                        <p className="font-semibold">{g.stat.views}</p>
                        <p className="text-xs text-muted-foreground">Visits</p>
                      </div>
                      <div>
                        <p className="font-semibold">{g.stat.downloads}</p>
                        <p className="text-xs text-muted-foreground">Downloads</p>
                      </div>
                      <div>
                        <p className="font-semibold">{g.stat.emails}</p>
                        <p className="text-xs text-muted-foreground">Emails</p>
                      </div>
                    </div>

                    <StatusBadge status={g.status} />

                    <div className="flex gap-2">
                      {g.status === "published" && <CopyUrlButton url={publicUrl} />}
                      {g.status !== "archived" && (
                        <Button
                          size="sm"
                          variant="outline"
                          render={<Link href={`/dashboard/gates/${g.id}/edit`} />}
                          nativeButton={false}
                        >
                          Edit
                        </Button>
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
