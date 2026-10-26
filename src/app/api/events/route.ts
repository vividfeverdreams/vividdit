import { NextResponse, type NextRequest } from "next/server"

import { isBotUserAgent } from "@/lib/bots"
import { hashRequestIp } from "@/lib/request-ip"
import { createAdminClient } from "@/lib/supabase/admin"
import { isVisitorId } from "@/lib/visitor-id"

// Fan-page analytics beacon (navigator.sendBeacon). Views are logged here
// rather than during the server render, so link-preview bots and prefetches
// don't count, and each visitor counts once per gate per UTC day (a unique
// index enforces it). 'open' events record which unlock step a fan tapped,
// once per step per day. Visitor ids are client-chosen, so a per-network
// budget (salted IP hash) keeps anyone from flooding a gate's numbers.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EVENTS_PER_VISITOR_DAY = 60
const MAX_EVENTS_PER_NETWORK_DAY = 300

type Beacon = {
  gateId?: unknown
  visitorId?: unknown
  type?: unknown
  step?: unknown
  statusToken?: unknown
  referrer?: unknown
  params?: unknown
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null

export async function POST(request: NextRequest) {
  let body: Beacon
  try {
    body = JSON.parse(await request.text()) as Beacon
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const gateId = typeof body.gateId === "string" && UUID.test(body.gateId) ? body.gateId : null
  const type = body.type === "view" || body.type === "open" ? body.type : null
  if (!gateId || !type || !isVisitorId(body.visitorId)) {
    return new NextResponse(null, { status: 400 })
  }
  if (isBotUserAgent(request.headers.get("user-agent"))) {
    return new NextResponse(null, { status: 204 })
  }
  // Browsers send Origin on POST; only the gate pages themselves may report.
  const origin = request.headers.get("origin")
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 })
  }
  const visitorId = body.visitorId
  const step = type === "open" ? text(body.step, 80) : null
  if (type === "open" && !step) return new NextResponse(null, { status: 400 })

  const admin = createAdminClient()
  const { data: gate } = await admin
    .from("gates")
    .select("id")
    .eq("id", gateId)
    .eq("status", "published")
    .maybeSingle()
  if (!gate) return new NextResponse(null, { status: 204 })

  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const ipHash = hashRequestIp(request.headers)
  const countToday = (column: "visitor_id" | "ip_hash", value: string) =>
    admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("gate_id", gateId)
      .eq(column, value)
      .gte("created_at", dayStart.toISOString())
  const [{ count: byVisitor }, { count: byNetwork }] = await Promise.all([
    countToday("visitor_id", visitorId),
    ipHash ? countToday("ip_hash", ipHash) : Promise.resolve({ count: 0 }),
  ])
  if (
    (byVisitor ?? 0) >= MAX_EVENTS_PER_VISITOR_DAY ||
    (byNetwork ?? 0) >= MAX_EVENTS_PER_NETWORK_DAY
  ) {
    return new NextResponse(null, { status: 204 })
  }

  let submissionId: string | null = null
  if (typeof body.statusToken === "string" && UUID.test(body.statusToken)) {
    const { data: submission } = await admin
      .from("submissions")
      .select("id")
      .eq("status_token", body.statusToken)
      .eq("gate_id", gateId)
      .maybeSingle()
    submissionId = submission?.id ?? null
  }

  const params =
    body.params && typeof body.params === "object"
      ? (body.params as Record<string, unknown>)
      : {}
  // A repeat view/open the same day hits events_visitor_daily_unique; that
  // conflict is the dedupe, so its error is ignored.
  await admin.from("events").insert({
    gate_id: gateId,
    event_type: type,
    visitor_id: visitorId,
    ip_hash: ipHash,
    step,
    submission_id: submissionId,
    utm_source: text(params.utm_source, 200),
    utm_medium: text(params.utm_medium, 200),
    utm_campaign: text(params.utm_campaign, 200),
    // ?src=sc / ?src=ig is the short form for tagging links by hand.
    source: text(params.src, 200) ?? text(params.source, 200) ?? text(params.ref, 200),
    referrer: text(body.referrer, 500),
  })

  return new NextResponse(null, { status: 204 })
}
