"use server"

import { createHash, randomInt } from "node:crypto"
import { after } from "next/server"
import { headers } from "next/headers"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { runVerification } from "@/lib/verification"

export type StartSubmissionResult =
  | {
      ok: true
      submissionId: string
      statusToken: string
      proofCode: string
      approved: boolean
    }
  | { ok: false; error: string }

const startSchema = z.object({
  gateId: z.uuid(),
  email: z.email("Enter a valid email").nullable(),
  consent: z.boolean(),
})

async function hashIp(): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers()
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip")
  const secret = process.env.API_KEY_ENCRYPTION_SECRET ?? "vividdit"
  return {
    ipHash: ip
      ? createHash("sha256").update(`${secret}:${ip}`).digest("hex")
      : null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  }
}

export async function startSubmissionAction(input: {
  gateId: string
  email: string | null
  consent: boolean
}): Promise<StartSubmissionResult> {
  const parsed = startSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }
  const d = parsed.data

  const admin = createAdminClient()
  const { data: gate } = await admin
    .from("gates")
    .select("id, status")
    .eq("id", d.gateId)
    .eq("status", "published")
    .maybeSingle()
  if (!gate) {
    return { ok: false, error: "This gate is no longer available." }
  }

  const { data: req } = await admin
    .from("gate_requirements")
    .select("email_enabled, soundcloud_enabled, instagram_enabled, spotify_enabled")
    .eq("gate_id", d.gateId)
    .single()
  if (!req) {
    return { ok: false, error: "This gate is misconfigured." }
  }

  if (req.email_enabled) {
    if (!d.email) return { ok: false, error: "Enter your email to unlock." }
    if (!d.consent) {
      return { ok: false, error: "Please accept to join the artist's list." }
    }
  }

  // Email-only gates unlock instantly — no proof or AI involved.
  const socialEnabled =
    req.soundcloud_enabled || req.instagram_enabled || req.spotify_enabled
  const approved = !socialEnabled

  const { ipHash, userAgent } = await hashIp()
  const proofCode = `GATE-${randomInt(1000, 10_000)}`

  // Rate limits (per hour) + fraud signals for the review queue.
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString()
  const fraudFlags: string[] = []
  if (ipHash) {
    const [{ count: gateCount }, { count: globalCount }] = await Promise.all([
      admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("gate_id", d.gateId)
        .eq("ip_hash", ipHash)
        .gte("created_at", hourAgo),
      admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", hourAgo),
    ])
    if ((gateCount ?? 0) >= 3 || (globalCount ?? 0) >= 15) {
      return {
        ok: false,
        error: "Too many attempts from your network — try again in an hour.",
      }
    }

    const { count: repeatIp } = await admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("gate_id", d.gateId)
      .eq("ip_hash", ipHash)
    if ((repeatIp ?? 0) > 0) fraudFlags.push("repeat_ip")
  }
  if (req.email_enabled && d.email) {
    const { count: repeatEmail } = await admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("gate_id", d.gateId)
      .eq("email", d.email)
    if ((repeatEmail ?? 0) > 0) fraudFlags.push("repeat_email")
  }

  const { data: submission, error } = await admin
    .from("submissions")
    .insert({
      gate_id: d.gateId,
      email: req.email_enabled ? d.email : null,
      email_purpose: req.email_enabled ? "fan_list" : null,
      email_consent: req.email_enabled ? d.consent : false,
      proof_code: proofCode,
      status: approved ? "approved" : "pending",
      decided_at: approved ? new Date().toISOString() : null,
      ip_hash: ipHash,
      user_agent: userAgent,
      fraud_flags: fraudFlags,
    })
    .select("id, status_token")
    .single()

  if (error || !submission) {
    return { ok: false, error: "Something went wrong. Try again." }
  }

  if (approved) {
    await admin.from("events").insert({
      gate_id: d.gateId,
      submission_id: submission.id,
      event_type: "approve",
    })
  }

  return {
    ok: true,
    submissionId: submission.id,
    statusToken: submission.status_token,
    proofCode,
    approved,
  }
}

/** Triggers AI verification once all stepped proofs are uploaded. */
export async function finalizeSubmissionAction(
  statusToken: string
): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(statusToken)) return { ok: false }
  const admin = createAdminClient()
  const { data: submission } = await admin
    .from("submissions")
    .select("id, gate_id, status")
    .eq("status_token", statusToken)
    .maybeSingle()
  if (!submission || !["pending", "rejected"].includes(submission.status)) {
    return { ok: false }
  }

  await admin
    .from("submissions")
    .update({ status: "pending" })
    .eq("id", submission.id)
  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submission.id,
    event_type: "submit",
  })
  after(() => runVerification(submission.id))
  return { ok: true }
}

/** Lightweight poll for the stepped flow's "verifying → download" transition. */
export async function getSubmissionStatusAction(
  statusToken: string
): Promise<{ status: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(statusToken)) return { status: null }
  const admin = createAdminClient()
  const { data } = await admin
    .from("submissions")
    .select("status")
    .eq("status_token", statusToken)
    .maybeSingle()
  return { status: data?.status ?? null }
}
