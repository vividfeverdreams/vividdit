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
import { cn } from "@/lib/utils"

export const metadata = { title: "Analytics" }

const RANGES = {
  "7d": { label: "7 days", days: 7 },
  "30d": { label: "30 days", days: 30 },
  all: { label: "All time", days: null },
} as const
type Range = keyof typeof RANGES

// Visits are counted once per visitor per gate per day from this deploy on.
// Before it, every page load (refreshes and link-preview bots included) counted.
const UNIQUE_VISITS_SINCE = "2026-10-27"

type Funnel = {
  visitors: number
  starts: number
  opens: number
  unlocks: number
  downloads: number
}

type GateRow = Funnel & { id: string; title: string }

const STAGES: { key: keyof Funnel; label: string; hint: string }[] = [
  { key: "visitors", label: "Visitors", hint: "opened a gate page" },
  { key: "starts", label: "Started", hint: "began unlocking" },
  { key: "opens", label: "Opened a follow", hint: "tapped through to a profile" },
  { key: "unlocks", label: "Unlocked", hint: "got the download" },
  { key: "downloads", label: "Downloaded", hint: "saved the file" },
]

function pct(part: number, whole: number): string {
  if (!whole) return "—"
  const value = (part / whole) * 100
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`
}

// Request-time dates, outside the component body for the purity lint.
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000)
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const sp = await searchParams
  const range: Range = sp.range && sp.range in RANGES ? (sp.range as Range) : "30d"
  const days = RANGES[range].days
  const since = days ? daysAgo(days) : null
  // The visitors-per-day chart shows at most the last 90 days.
  const chartDays = days ?? 90
  const chartSince = daysAgo(chartDays - 1)
  chartSince.setUTCHours(0, 0, 0, 0)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Aggregated in the database: the API caps raw row reads at 1,000.
  const [{ data: gates }, { data: funnelRows }, { data: dailyRows }, { data: sourceRows }] =
    await Promise.all([
      supabase.from("gates").select("id, title").eq("creator_id", user.id),
      supabase.rpc("gate_funnel", { p_since: since?.toISOString() ?? null }),
      supabase.rpc("gate_daily_views", { p_since: chartSince.toISOString() }),
      supabase.rpc("gate_view_sources", { p_since: since?.toISOString() ?? null }),
    ])

  const titleById = new Map((gates ?? []).map((g) => [g.id, g.title]))
  const rows: GateRow[] = ((funnelRows ?? []) as Record<string, unknown>[])
    .map((r) => ({
      id: r.gate_id as string,
      title: titleById.get(r.gate_id as string) ?? "Untitled",
      visitors: Number(r.visitors ?? 0),
      starts: Number(r.starts ?? 0),
      opens: Number(r.opens ?? 0),
      unlocks: Number(r.unlocks ?? 0),
      downloads: Number(r.downloads ?? 0),
    }))
    .filter((r) => r.visitors || r.starts || r.downloads)
    .sort((a, b) => b.visitors - a.visitors)

  const total: Funnel = rows.reduce(
    (sum, r) => ({
      visitors: sum.visitors + r.visitors,
      starts: sum.starts + r.starts,
      opens: sum.opens + r.opens,
      unlocks: sum.unlocks + r.unlocks,
      downloads: sum.downloads + r.downloads,
    }),
    { visitors: 0, starts: 0, opens: 0, unlocks: 0, downloads: 0 }
  )

  const perDay = new Map<string, number>()
  for (let i = 0; i < chartDays; i++) {
    perDay.set(dayKey(new Date(chartSince.getTime() + i * 24 * 3600 * 1000)), 0)
  }
  for (const row of (dailyRows ?? []) as { day: string; views: number }[]) {
    if (perDay.has(row.day)) perDay.set(row.day, Number(row.views))
  }
  const daily = [...perDay.entries()]
  const dailyMax = Math.max(1, ...daily.map(([, n]) => n))
  const sources = ((sourceRows ?? []) as { source: string; views: number }[]).map(
    (r) => [r.source, Number(r.views)] as const
  )
  const sourcesTotal = sources.reduce((sum, [, n]) => sum + n, 0)
  const topSources = sources.slice(0, 8)
  const hasData = rows.length > 0

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <div className="flex items-center gap-2">
          <nav aria-label="Date range" className="flex rounded-lg border p-0.5">
            {(Object.keys(RANGES) as Range[]).map((key) => (
              <Link
                key={key}
                href={`/dashboard/analytics?range=${key}`}
                aria-current={key === range ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  key === range
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {RANGES[key].label}
              </Link>
            ))}
          </nav>
          {hasData && (
            <Button
              render={<Link href="/dashboard/analytics/export" prefetch={false} />}
              nativeButton={false}
              variant="outline"
            >
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CardTitle>No data yet</CardTitle>
            <CardDescription>
              Visitors, unlocks and downloads appear once your gates get traffic.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Download funnel</CardTitle>
              <CardDescription>
                All gates, {RANGES[range].label.toLowerCase()}. Visitors count
                once per gate per day since {UNIQUE_VISITS_SINCE}; before that,
                every page load counted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {STAGES.map((stage) => {
                  const value = total[stage.key]
                  const width = total.visitors ? (value / total.visitors) * 100 : 0
                  return (
                    <li key={stage.key} className="grid grid-cols-[9rem_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr]">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{stage.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {stage.hint}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-6 flex-1">
                          <div
                            className="h-full rounded-r bg-foreground/80"
                            style={{ width: `${Math.max(width, value ? 0.75 : 0)}%` }}
                          />
                        </div>
                        <p className="w-24 shrink-0 text-right text-sm tabular-nums">
                          <span className="font-semibold">{value.toLocaleString("en-US")}</span>{" "}
                          <span className="text-muted-foreground">
                            {stage.key === "visitors" ? "" : pct(value, total.visitors)}
                          </span>
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visitors per day</CardTitle>
              <CardDescription>
                Last {chartDays} days, all gates. Hover or focus a day for its count.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="flex h-36 items-end gap-0.5 border-b"
                role="list"
                aria-label="Visitors per day"
              >
                {daily.map(([day, count]) => (
                  <div
                    key={day}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`${day}: ${count} visitors`}
                    className="group relative flex h-full max-w-6 flex-1 items-end outline-none"
                  >
                    <div
                      className="w-full rounded-t bg-foreground/70 transition-colors group-hover:bg-foreground group-focus-visible:bg-foreground"
                      style={{ height: count ? `${Math.max(3, (count / dailyMax) * 100)}%` : 0 }}
                    />
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-sm group-hover:block group-focus-visible:block">
                      <span className="font-semibold tabular-nums">{count}</span>{" "}
                      <span className="text-muted-foreground">{day}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{daily[0]?.[0]}</span>
                <span>Peak {dailyMax.toLocaleString("en-US")} / day</span>
                <span>{daily[daily.length - 1]?.[0]}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By song</CardTitle>
              <CardDescription>
                Where each gate loses fans. DL rate is downloads per visitor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gate</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Started</TableHead>
                    <TableHead className="text-right">Followed</TableHead>
                    <TableHead className="text-right">Unlocked</TableHead>
                    <TableHead className="text-right">Downloaded</TableHead>
                    <TableHead className="w-32 text-right">DL rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const rate = r.visitors ? r.downloads / r.visitors : 0
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-48 truncate font-medium">
                          {r.title}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.visitors}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.starts}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.opens}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.unlocks}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.downloads}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-2 w-14 rounded-full bg-muted" aria-hidden="true">
                              <div
                                className="h-full rounded-full bg-foreground/80"
                                style={{ width: `${Math.min(100, rate * 100 * 4)}%` }}
                              />
                            </div>
                            <span className="w-11 text-right tabular-nums">
                              {pct(r.downloads, r.visitors)}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {topSources.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where visitors come from</CardTitle>
                <CardDescription>
                  Tag your links to fill this in: add <code>?src=sc</code> to
                  SoundCloud links and <code>?src=ig</code> to your Instagram bio.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {topSources.map(([src, count]) => (
                    <li key={src} className="flex justify-between gap-4">
                      <span className="truncate">{src}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {count} · {pct(count, sourcesTotal)}
                      </span>
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
