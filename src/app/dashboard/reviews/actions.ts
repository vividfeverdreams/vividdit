"use server"

import { revalidatePath } from "next/cache"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { completeApproval, notifyRejection, type UnlockGate } from "@/lib/unlock"

// Loads the submission only if it belongs to one of the signed-in creator's
// gates (user-scoped client → RLS enforces ownership).
async function loadOwnSubmission(submissionId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("submissions")
    .select(
      "id, gate_id, status, status_token, email, fraud_flags, gates(title, artist, slug, kind, creator_id, profiles:profiles!gates_creator_id_fkey(artist_slug))"
    )
    .eq("id", submissionId)
    .maybeSingle()
  return data
}

function refresh() {
  revalidatePath("/dashboard/reviews")
  // The nav badge lives in the dashboard layout.
  revalidatePath("/dashboard", "layout")
}

export async function approveSubmissionAction(formData: FormData) {
  const submissionId = formData.get("submissionId")
  if (typeof submissionId !== "string") return

  const submission = await loadOwnSubmission(submissionId)
  if (!submission || submission.status !== "needs_review") return

  const supabase = await createClient()
  const { data: approved, error: approveError } = await supabase
    .from("submissions")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("id", submissionId)
    .eq("status", "needs_review")
    .select("id")
    .maybeSingle()
  if (approveError || !approved) return

  await completeApproval(
    createAdminClient(),
    {
      id: submission.id,
      gate_id: submission.gate_id,
      email: submission.email,
      status_token: submission.status_token,
    },
    submission.gates as unknown as UnlockGate
  )

  refresh()
}

export async function rejectSubmissionAction(formData: FormData) {
  const submissionId = formData.get("submissionId")
  if (typeof submissionId !== "string") return

  const submission = await loadOwnSubmission(submissionId)
  if (!submission || submission.status !== "needs_review") return

  const supabase = await createClient()
  const { data: rejected, error: rejectError } = await supabase
    .from("submissions")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", submissionId)
    .eq("status", "needs_review")
    .select("id")
    .maybeSingle()
  if (rejectError || !rejected) return

  const admin = createAdminClient()
  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submissionId,
    event_type: "reject",
  })

  const gate = submission.gates as unknown as UnlockGate & {
    slug: string
    profiles: { artist_slug: string } | null
  }
  await notifyRejection(admin, submission, {
    ...gate,
    artistSlug: gate.profiles?.artist_slug ?? null,
  })

  refresh()
}

/**
 * For a fan let through while the AI couldn't check: ends their access to
 * further downloads. No email; they already have what they downloaded.
 */
export async function revokeSubmissionAction(formData: FormData) {
  const submissionId = formData.get("submissionId")
  if (typeof submissionId !== "string") return

  const submission = await loadOwnSubmission(submissionId)
  if (!submission || submission.status !== "approved") return

  // Final: the fan loses download access and can't unlock this submission
  // again by re-sending the same screenshots.
  const flags = ((submission.fraud_flags as string[]) ?? []).filter(
    (f) => f !== "ai_unavailable"
  )
  const supabase = await createClient()
  const { data: revoked } = await supabase
    .from("submissions")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      unlocked_at: null,
      fraud_flags: [...flags, "revoked"],
    })
    .eq("id", submissionId)
    .eq("status", "approved")
    .select("id")
    .maybeSingle()
  if (!revoked) return

  await createAdminClient().from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submissionId,
    event_type: "reject",
  })
  refresh()
}

/** Clears the "let through without a check" note once the creator has looked. */
export async function dismissUncheckedAction(formData: FormData) {
  const submissionId = formData.get("submissionId")
  if (typeof submissionId !== "string") return

  const submission = await loadOwnSubmission(submissionId)
  if (!submission) return
  const flags = ((submission.fraud_flags as string[]) ?? []).filter(
    (f) => f !== "ai_unavailable"
  )
  const supabase = await createClient()
  await supabase
    .from("submissions")
    .update({ fraud_flags: flags })
    .eq("id", submissionId)
  refresh()
}
