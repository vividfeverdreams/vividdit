import "server-only"

import { mintDownloadToken } from "@/lib/downloads"
import {
  sendDownloadEmail,
  sendRejectionEmail,
  sendVaultDownloadEmail,
} from "@/lib/email"
import { createAdminClient } from "@/lib/supabase/admin"

// One path for every way a fan gets their download: a quick unlock, an AI
// approval, a creator decision, or the 24-hour auto-approve. Each step is
// idempotent, so whichever path gets there first does the work once.

export const AUTO_APPROVE_HOURS = 24

type Admin = ReturnType<typeof createAdminClient>

export type UnlockGate = {
  kind: string
  title: string
  artist: string
  creator_id: string
}

export type UnlockSubmission = {
  id: string
  gate_id: string
  email: string | null
  status_token: string
}

const SUBMISSION_FIELDS =
  "id, gate_id, email, status_token, gates(kind, title, artist, creator_id)"

/** Records when the fan first got the download. Later calls are no-ops. */
export async function markUnlocked(admin: Admin, submissionId: string) {
  await admin
    .from("submissions")
    .update({ unlocked_at: new Date().toISOString() })
    .eq("id", submissionId)
    .is("unlocked_at", null)
}

/**
 * Emails the fan their download link, once per submission. The claim on
 * download_emailed_at is released only when the creator has no Resend key
 * (nothing was attempted). A failed or timed-out send keeps the claim: Resend
 * may have delivered it, and the fan still has their download page.
 */
export async function emailDownloadOnce(
  admin: Admin,
  submission: UnlockSubmission,
  gate: UnlockGate
): Promise<void> {
  if (!submission.email) return
  const { data: claimed } = await admin
    .from("submissions")
    .update({ download_emailed_at: new Date().toISOString() })
    .eq("id", submission.id)
    .is("download_emailed_at", null)
    .select("id")
    .maybeSingle()
  if (!claimed) return

  const idempotencyKey = `download-${submission.id}`
  let attempted = true
  try {
    if (gate.kind === "vault") {
      attempted = await sendVaultDownloadEmail({
        creatorId: gate.creator_id,
        to: submission.email,
        gateTitle: gate.title,
        artist: gate.artist,
        statusToken: submission.status_token,
        idempotencyKey,
      })
    } else {
      attempted = await sendDownloadEmail({
        creatorId: gate.creator_id,
        to: submission.email,
        gateTitle: gate.title,
        artist: gate.artist,
        downloadToken: await mintDownloadToken(submission.id),
        idempotencyKey,
      })
    }
  } catch (err) {
    console.error("download email failed:", err)
  }
  if (!attempted) {
    await admin
      .from("submissions")
      .update({ download_emailed_at: null })
      .eq("id", submission.id)
  }
}

/**
 * Everything that follows an approval: download access, the approve event and
 * the email. Callers own the status change itself (a compare-and-set, so only
 * one of them gets here).
 */
export async function completeApproval(
  admin: Admin,
  submission: UnlockSubmission,
  gate: UnlockGate,
  opts: { email?: boolean } = {}
): Promise<void> {
  await markUnlocked(admin, submission.id)
  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submission.id,
    event_type: "approve",
  })
  if (opts.email !== false) await emailDownloadOnce(admin, submission, gate)
}

/**
 * Approves a submission if it is still in one of `from`. Returns the approved
 * submission (for a deferred email), or null when another path decided first.
 */
export async function approveSubmission(
  admin: Admin,
  submissionId: string,
  from: string[],
  opts: { email?: boolean } = {}
): Promise<{ submission: UnlockSubmission; gate: UnlockGate } | null> {
  const { data } = await admin
    .from("submissions")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("id", submissionId)
    .in("status", from)
    .select(SUBMISSION_FIELDS)
    .maybeSingle()
  if (!data) return null
  const gate = data.gates as unknown as UnlockGate
  const submission: UnlockSubmission = {
    id: data.id,
    gate_id: data.gate_id,
    email: data.email,
    status_token: data.status_token,
  }
  await completeApproval(admin, submission, gate, opts)
  return { submission, gate }
}

/** Emails a rejected fan what to fix, using the AI's last note when there is one. */
export async function notifyRejection(
  admin: Admin,
  submission: { id: string; email: string | null },
  gate: UnlockGate & { slug: string; artistSlug: string | null }
): Promise<void> {
  if (!submission.email) return
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const { data: run } = await admin
    .from("verification_runs")
    .select("result")
    .eq("submission_id", submission.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const reason =
    (run?.result as { fan_message?: string } | null)?.fan_message ?? null
  try {
    await sendRejectionEmail({
      creatorId: gate.creator_id,
      to: submission.email,
      gateTitle: gate.title,
      artist: gate.artist,
      reason,
      gateUrl: `${base}/${gate.artistSlug}/${gate.slug}`,
    })
  } catch (err) {
    console.error("rejection email failed:", err)
  }
}

export function reviewAgeStart(submission: {
  review_started_at: string | null
  created_at: string
}): number {
  return new Date(submission.review_started_at ?? submission.created_at).getTime()
}

export function isStaleReview(
  submission: {
    status: string
    review_started_at: string | null
    created_at: string
  },
  now = Date.now()
): boolean {
  return (
    submission.status === "needs_review" &&
    now - reviewAgeStart(submission) >= AUTO_APPROVE_HOURS * 3600 * 1000
  )
}

/** Approves every review that has waited 24 hours. Returns how many. */
export async function autoApproveStaleReviews(
  admin: Admin,
  limit = 50
): Promise<number> {
  const { data } = await admin
    .from("submissions")
    .select("id, status, review_started_at, created_at")
    .eq("status", "needs_review")
    .order("created_at", { ascending: true })
    .limit(500)
  let approved = 0
  for (const row of (data ?? []).filter((s) => isStaleReview(s)).slice(0, limit)) {
    if (await approveSubmission(admin, row.id, ["needs_review"])) approved++
  }
  return approved
}
