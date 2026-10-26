"use server"

import { randomInt } from "node:crypto"
import { after } from "next/server"
import { headers } from "next/headers"
import { z } from "zod"

import { hasDownloadAccess } from "@/lib/downloads"
import { canEmailFans } from "@/lib/email-keys"
import { hashRequestIp } from "@/lib/request-ip"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  approveSubmission,
  completeApproval,
  emailDownloadOnce,
  isStaleReview,
  markUnlocked,
  type UnlockGate,
} from "@/lib/unlock"
import { isVisitorId } from "@/lib/visitor-id"
import { runVerification } from "@/lib/verification"

export type StartSubmissionResult =
  | {
      ok: true
      submissionId: string
      statusToken: string
      proofCode: string
      approved: boolean
      emailed: boolean
    }
  | { ok: false; error: string }

const startSchema = z.object({
  gateId: z.uuid(),
  email: z.email("Enter a valid email").nullable(),
  consent: z.boolean(),
  visitorId: z.string().nullable().optional(),
})

const STATUS_TOKEN = /^[0-9a-f-]{36}$/i

async function hashIp(): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers()
  return {
    ipHash: hashRequestIp(h),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  }
}

export async function startSubmissionAction(input: {
  gateId: string
  email: string | null
  consent: boolean
  visitorId?: string | null
}): Promise<StartSubmissionResult> {
  const parsed = startSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }
  const d = parsed.data

  const admin = createAdminClient()
  const { data: gate } = await admin
    .from("gates")
    .select("id, status, kind, title, artist, creator_id")
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

  const visitorId = d.visitorId && isVisitorId(d.visitorId) ? d.visitorId : null
  await admin.from("events").insert({
    gate_id: d.gateId,
    submission_id: submission.id,
    event_type: "start",
    visitor_id: visitorId,
  })

  if (approved) {
    const unlocked = {
      id: submission.id,
      gate_id: d.gateId,
      email: req.email_enabled ? d.email : null,
      status_token: submission.status_token,
    }
    const unlockGate = gate as UnlockGate
    await completeApproval(admin, unlocked, unlockGate, { email: false })
    after(() => emailDownloadOnce(createAdminClient(), unlocked, unlockGate))
  }

  return {
    ok: true,
    submissionId: submission.id,
    statusToken: submission.status_token,
    proofCode,
    approved,
    emailed: approved && !!d.email && (await canEmailFans(gate.creator_id)),
  }
}

type GateSteps = {
  unlockMode: "quick" | "verified"
  trackStep: boolean
  targetIds: string[]
}

async function loadGateSteps(
  admin: ReturnType<typeof createAdminClient>,
  gateId: string
): Promise<GateSteps | null> {
  const [{ data: req }, { data: targets }] = await Promise.all([
    admin
      .from("gate_requirements")
      .select("unlock_mode, require_like, require_repost")
      .eq("gate_id", gateId)
      .maybeSingle(),
    admin.from("gate_follow_targets").select("id").eq("gate_id", gateId),
  ])
  if (!req) return null
  return {
    unlockMode: req.unlock_mode === "verified" ? "verified" : "quick",
    trackStep: req.require_like || req.require_repost,
    targetIds: (targets ?? []).map((t) => t.id),
  }
}

async function loadFanSubmission(statusToken: string) {
  if (!STATUS_TOKEN.test(statusToken)) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from("submissions")
    .select(
      "id, gate_id, status, email, status_token, unlocked_at, decided_at, fraud_flags, gates(kind, title, artist, creator_id, status)"
    )
    .eq("status_token", statusToken)
    .maybeSingle()
  return data ? { admin, submission: data } : null
}

export type UnlockResult =
  | { ok: true; emailed: boolean }
  | { ok: false; error: string }

/**
 * Quick unlock: the fan tapped through every follow. Like Hypeddit since
 * SoundCloud closed its API, this is an honor system; the email and the
 * follows are the point, not proof.
 */
export async function quickUnlockAction(input: {
  statusToken: string
  completedSteps: string[]
}): Promise<UnlockResult> {
  const loaded = await loadFanSubmission(input.statusToken)
  if (!loaded) return { ok: false, error: "Something went wrong. Reload and try again." }
  const { admin, submission } = loaded
  const gate = submission.gates as unknown as UnlockGate & { status: string }
  if (gate.status !== "published") {
    return { ok: false, error: "This gate is no longer available." }
  }
  if (submission.status === "approved") {
    return { ok: true, emailed: !!submission.email && (await canEmailFans(gate.creator_id)) }
  }
  if (submission.status !== "pending") {
    return { ok: false, error: "Something went wrong. Reload and try again." }
  }

  const steps = await loadGateSteps(admin, submission.gate_id)
  if (!steps || steps.unlockMode !== "quick") {
    return { ok: false, error: "Reload the page and try again." }
  }
  const done = new Set(input.completedSteps)
  const missing =
    (steps.trackStep && !done.has("track")) ||
    steps.targetIds.some((id) => !done.has(id))
  if (missing) return { ok: false, error: "Finish every step to unlock." }

  const approved = await approveSubmission(admin, submission.id, ["pending"], {
    email: false,
  })
  if (approved) {
    after(() =>
      emailDownloadOnce(createAdminClient(), approved.submission, approved.gate)
    )
  }
  return {
    ok: true,
    emailed: !!submission.email && (await canEmailFans(gate.creator_id)),
  }
}

/**
 * Verified unlock: every step has a screenshot. The fan gets the download now;
 * the AI checks the screenshots in the background and a rejection revokes
 * access later.
 */
export async function verifiedUnlockAction(input: {
  statusToken: string
}): Promise<UnlockResult> {
  const loaded = await loadFanSubmission(input.statusToken)
  if (!loaded) return { ok: false, error: "Something went wrong. Reload and try again." }
  const { admin, submission } = loaded
  const gate = submission.gates as unknown as UnlockGate & { status: string }
  if (gate.status !== "published") {
    return { ok: false, error: "This gate is no longer available." }
  }
  if (submission.status === "approved") {
    return { ok: true, emailed: !!submission.email && (await canEmailFans(gate.creator_id)) }
  }

  // After a rejection the fan only gets back in with new screenshots, which
  // the AI checks again; an artist's revocation is final.
  if (submission.status === "rejected") {
    if (((submission.fraud_flags as string[]) ?? []).includes("revoked")) {
      return { ok: false, error: "This download is no longer available to you." }
    }
    const { count: fresh } = await admin
      .from("proof_images")
      .select("id", { count: "exact", head: true })
      .eq("submission_id", submission.id)
      .gt("created_at", submission.decided_at ?? submission.unlocked_at ?? "-infinity")
    if (!fresh) {
      return { ok: false, error: "Add a new screenshot for the steps that didn't pass." }
    }
  }

  const steps = await loadGateSteps(admin, submission.gate_id)
  if (!steps) return { ok: false, error: "Reload the page and try again." }
  const { data: proofs } = await admin
    .from("proof_images")
    .select("follow_target_id")
    .eq("submission_id", submission.id)
  const covered = new Set((proofs ?? []).map((p) => p.follow_target_id ?? "track"))
  const missing =
    (steps.trackStep && !covered.has("track")) ||
    steps.targetIds.some((id) => !covered.has(id))
  if (missing) return { ok: false, error: "Add a screenshot for every step." }

  if (submission.status !== "verifying") {
    const { data: claimed, error } = await admin.rpc(
      "claim_submission_verification",
      {
        p_submission_id: submission.id,
        p_status_token: input.statusToken,
      }
    )
    if (error || !claimed) {
      return { ok: false, error: "Something went wrong. Reload and try again." }
    }
  }

  await markUnlocked(admin, submission.id)
  const unlocked = {
    id: submission.id,
    gate_id: submission.gate_id,
    email: submission.email,
    status_token: submission.status_token,
  }
  after(async () => {
    const worker = createAdminClient()
    await emailDownloadOnce(worker, unlocked, gate)
    await runVerification(submission.id, input.statusToken)
  })
  return {
    ok: true,
    emailed: !!submission.email && (await canEmailFans(gate.creator_id)),
  }
}

/**
 * The fan's saved progress, re-checked when they come back to the gate. Also
 * clears a review that has waited past the auto-approve window.
 */
export async function getSubmissionStatusAction(
  statusToken: string
): Promise<{ status: string | null; unlocked: boolean }> {
  if (!STATUS_TOKEN.test(statusToken)) return { status: null, unlocked: false }
  const admin = createAdminClient()
  const { data } = await admin
    .from("submissions")
    .select(
      "id, status, unlocked_at, review_started_at, created_at, verification_dispatched_at"
    )
    .eq("status_token", statusToken)
    .maybeSingle()
  if (!data) return { status: null, unlocked: false }

  if (
    data.status === "verifying" &&
    (!data.verification_dispatched_at ||
      new Date(data.verification_dispatched_at).getTime() <
        Date.now() - 3 * 60 * 1000)
  ) {
    // Recover a worker that disappeared after claiming dispatch. The bounded
    // database lease prevents overlapping paid verification work.
    after(() => runVerification(data.id, statusToken))
  }

  if (isStaleReview(data) && (await approveSubmission(admin, data.id, ["needs_review"]))) {
    return { status: "approved", unlocked: true }
  }

  return {
    status: data.status,
    unlocked: hasDownloadAccess(data),
  }
}
