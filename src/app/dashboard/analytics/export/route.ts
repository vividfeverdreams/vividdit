import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse("Not signed in.", { status: 401 })
  }

  // RLS scopes events to the creator's gates; join slugs for readability.
  const { data: gates } = await supabase
    .from("gates")
    .select("id, slug")
    .eq("creator_id", user.id)
  const slugById = new Map((gates ?? []).map((g) => [g.id, g.slug]))

  const { data: events } = await supabase
    .from("events")
    .select(
      "gate_id, event_type, utm_source, utm_medium, utm_campaign, referrer, source, created_at"
    )
    .order("created_at", { ascending: true })
    .limit(50_000)

  const rows = [
    [
      "gate",
      "event",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "referrer",
      "source",
      "at",
    ],
  ]
  for (const e of events ?? []) {
    rows.push([
      slugById.get(e.gate_id) ?? e.gate_id,
      e.event_type,
      e.utm_source ?? "",
      e.utm_medium ?? "",
      e.utm_campaign ?? "",
      e.referrer ?? "",
      e.source ?? "",
      e.created_at,
    ])
  }

  const csv = rows.map((r) => r.map(csvField).join(",")).join("\n") + "\n"
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="vividdit-events.csv"',
    },
  })
}
