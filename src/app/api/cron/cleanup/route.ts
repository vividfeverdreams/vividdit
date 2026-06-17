import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"

const PROOF_RETENTION_DAYS = 30
const VERIFYING_STUCK_MINUTES = 10

// Daily maintenance, called by Vercel Cron in production (vercel.json) and
// manually in dev: curl -H "authorization: Bearer $CRON_SECRET" /api/cron/cleanup
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const cutoff = new Date(
    Date.now() - PROOF_RETENTION_DAYS * 24 * 3600 * 1000
  ).toISOString()

  // 1. Proof screenshots past retention — but never while a review is open.
  const { data: oldProofs } = await admin
    .from("proof_images")
    .select("id, storage_path, submissions!inner(status)")
    .lt("created_at", cutoff)
    .in("submissions.status", ["approved", "rejected"])
    .limit(500)

  let proofsDeleted = 0
  if (oldProofs && oldProofs.length > 0) {
    const paths = oldProofs.map((p) => p.storage_path)
    const { error: storageError } = await admin.storage
      .from("proofs")
      .remove(paths)
    if (!storageError) {
      await admin
        .from("proof_images")
        .delete()
        .in(
          "id",
          oldProofs.map((p) => p.id)
        )
      proofsDeleted = oldProofs.length
    }
  }

  // 2. Expired download tokens have no further use.
  const { count: tokensDeleted } = await admin
    .from("download_tokens")
    .delete({ count: "exact" })
    .lt("expires_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())

  // 3. Submissions stuck in "verifying" (crashed mid-pipeline) go to the
  // creator's queue instead of hanging forever.
  const stuckCutoff = new Date(
    Date.now() - VERIFYING_STUCK_MINUTES * 60 * 1000
  ).toISOString()
  const { count: unstuck } = await admin
    .from("submissions")
    .update({ status: "needs_review" }, { count: "exact" })
    .eq("status", "verifying")
    .lt("updated_at", stuckCutoff)

  // 4. Data minimization: drop transactional fan emails we no longer need.
  // An email is only retained long-term when the fan opted into the creator's
  // list (email_consent = true). Emails captured solely to deliver a one-time
  // download are nulled once the submission is terminal and past retention —
  // the row stays (for analytics counts) but the PII is shed.
  const { count: emailsMinimized } = await admin
    .from("submissions")
    .update({ email: null }, { count: "exact" })
    .in("status", ["approved", "rejected"])
    .eq("email_consent", false)
    .not("email", "is", null)
    .lt("created_at", cutoff)

  return NextResponse.json({
    ok: true,
    proofsDeleted,
    tokensDeleted: tokensDeleted ?? 0,
    unstuckSubmissions: unstuck ?? 0,
    emailsMinimized: emailsMinimized ?? 0,
  })
}
