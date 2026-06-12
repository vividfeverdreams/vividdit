import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// Fan-list CSV. email_purpose = 'review_status' rows are excluded by the
// filter below — status-only emails are never exported.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse("Not signed in.", { status: 401 })
  }

  const { data: fans } = await supabase
    .from("submissions")
    .select(
      "email, email_consent, status, created_at, gates!inner(title, slug, creator_id)"
    )
    .eq("gates.creator_id", user.id)
    .eq("email_purpose", "fan_list")
    .not("email", "is", null)
    .order("created_at", { ascending: true })

  const rows = [["email", "gate", "gate_slug", "consent", "status", "submitted_at"]]
  for (const f of fans ?? []) {
    const gate = f.gates as unknown as { title: string; slug: string }
    rows.push([
      f.email!,
      gate.title,
      gate.slug,
      f.email_consent ? "yes" : "no",
      f.status,
      f.created_at,
    ])
  }

  const csv = rows.map((r) => r.map(csvField).join(",")).join("\n") + "\n"
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="vividdit-fans.csv"',
    },
  })
}
