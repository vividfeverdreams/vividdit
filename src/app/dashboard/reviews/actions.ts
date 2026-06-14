"use server"

import { revalidatePath } from "next/cache"

import { mintDownloadToken } from "@/lib/downloads"
import { sendDownloadEmail, sendRejectionEmail } from "@/lib/email"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

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
      "id, gate_id, status, email, gates(title, artist, slug, creator_id, profiles:profiles!gates_creator_id_fkey(artist_slug))"
    )
    .eq("id", submissionId)
    .maybeSingle()
  return data
}

export async function approveSubmissionAction(formData: FormData) {
  const submissionId = formData.get("submissionId")
  if (typeof submissionId !== "string") return

  const submission = await loadOwnSubmission(submissionId)
  if (!submission || submission.status !== "needs_review") return

  const supabase = await createClient()
  await supabase
    .from("submissions")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("id", submissionId)

  const admin = createAdminClient()
  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submissionId,
    event_type: "approve",
  })

  const gate = submission.gates as unknown as {
    title: string
    artist: string
    creator_id: string
  }
  if (submission.email) {
    try {
      const token = await mintDownloadToken(submissionId)
      await sendDownloadEmail({
        creatorId: gate.creator_id,
        to: submission.email,
        gateTitle: gate.title,
        artist: gate.artist,
        downloadToken: token,
      })
    } catch (err) {
      console.error("approval email failed:", err)
    }
  }

  revalidatePath("/dashboard/reviews")
}

export async function rejectSubmissionAction(formData: FormData) {
  const submissionId = formData.get("submissionId")
  if (typeof submissionId !== "string") return

  const submission = await loadOwnSubmission(submissionId)
  if (!submission || submission.status !== "needs_review") return

  const supabase = await createClient()
  await supabase
    .from("submissions")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", submissionId)

  const admin = createAdminClient()
  await admin.from("events").insert({
    gate_id: submission.gate_id,
    submission_id: submissionId,
    event_type: "reject",
  })

  const gate = submission.gates as unknown as {
    title: string
    artist: string
    slug: string
    creator_id: string
    profiles: { artist_slug: string } | null
  }
  if (submission.email) {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    // Latest AI fan_message gives the fan something actionable.
    const { data: run } = await admin
      .from("verification_runs")
      .select("result")
      .eq("submission_id", submissionId)
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
        gateUrl: `${base}/${gate.profiles?.artist_slug}/${gate.slug}`,
      })
    } catch (err) {
      console.error("rejection email failed:", err)
    }
  }

  revalidatePath("/dashboard/reviews")
}
