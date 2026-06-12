import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Analytics" }

type GateStats = {
  title: string
  slug: string
  views: number
  submissions: number
  approved: number
  rejected: number
  inReview: number
  downloads: number
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [{ data: gates }, { data: events }, { data: submissions }] =
    await Promise.all([
      supabase
        .from("gates")
        .select("id, title, slug")
        .eq("creator_id", user.id),
      supabase
        .from("events")
        .select("gate_id, event_type, utm_source, referrer")
        .limit(10_000),
      supabase
        .from("submissions")
        .select("gate_id, status, gates!inner(creator_id)")
        .eq("gates.creator_id", user.id),
    ])

  const stats = new Map<string, GateStats>()
  for (const g of gates ?? []) {
    stats.set(g.id, {
      title: g.title,
      slug: g.slug,
      views: 0,
      submissions: 0,
      approved: 0,
      rejected: 0,
      inReview: 0,
      downloads: 0,
    })
  }

  const sources = new Map<string, number>()
  for (const e of events ?? []) {
    const s = stats.get(e.gate_id)
    if (!s) continue
    if (e.event_type === "view") {
      s.views++
      const src = e.utm_source ?? (e.referrer ? new URL(e.referrer).hostname : "direct")
      sources.set(src, (sources.get(src) ?? 0) + 1)
    }
    if (e.event_type === "download") s.downloads++
  }

  for (const sub of submissions ?? []) {
    const s = stats.get(sub.gate_id)
    if (!s) continue
    s.submissions++
    if (sub.status === "approved") s.approved++
    else if (sub.status === "rejected") s.rejected++
    else if (sub.status === "needs_review") s.inReview++
  }

  const rows = [...stats.values()].sort((a, b) => b.views - a.views)
  const topSources = [...sources.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const hasData = rows.some((r) => r.views || r.submissions)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        {hasData && (
          <Button
            render={
              <Link href="/dashboard/analytics/export" prefetch={false} />
            }
            nativeButton={false}
            variant="outline"
          >
            Export events CSV
          </Button>
        )}
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CardTitle>No data yet</CardTitle>
            <CardDescription>
              Views, submissions, and downloads appear once your gates get
              traffic.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gate</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Submissions</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead className="text-right">In review</TableHead>
                    <TableHead className="text-right">Approval rate</TableHead>
                    <TableHead className="text-right">Downloads</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.slug}>
                      <TableCell className="max-w-44 truncate font-medium">
                        {r.title}
                      </TableCell>
                      <TableCell className="text-right">{r.views}</TableCell>
                      <TableCell className="text-right">{r.submissions}</TableCell>
                      <TableCell className="text-right">{r.approved}</TableCell>
                      <TableCell className="text-right">{r.inReview}</TableCell>
                      <TableCell className="text-right">
                        {r.submissions
                          ? `${Math.round((r.approved / r.submissions) * 100)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">{r.downloads}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {topSources.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top sources</CardTitle>
                <CardDescription>
                  Where gate views come from (UTM source or referrer).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {topSources.map(([src, count]) => (
                    <li key={src} className="flex justify-between">
                      <span>{src}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
