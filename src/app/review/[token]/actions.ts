"use server"

import { redirect } from "next/navigation"

import { verifyReviewToken } from "@/lib/review-links"
import { createAdminClient } from "@/lib/supabase/admin"
import { approveSubmission, notifyRejection, type UnlockGate } from "@/lib/unlock"

// Decisions from the emailed review link. The signed token is the capability;
// it covers exactly one submission and expires.

export async function decideFromLinkAction(formData: FormData) {
  const token = formData.get("token")
  const decision = formData.get("decision")
  if (typeof token !== "string") return
  const submissionId = verifyReviewToken(token)
  if (!submissionId) return

  const admin = createAdminClient()
  if (decision === "approve") {
    await approveSubmission(admin, submissionId, ["needs_review"])
  } else if (decision === "reject") {
    const { data } = await admin
      .from("submissions")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", submissionId)
      .eq("status", "needs_review")
      .select(
        "id, gate_id, email, gates(title, artist, slug, kind, creator_id, profiles:profiles!gates_creator_id_fkey(artist_slug))"
      )
      .maybeSingle()
    if (data) {
      await admin.from("events").insert({
        gate_id: data.gate_id,
        submission_id: data.id,
        event_type: "reject",
      })
      const gate = data.gates as unknown as UnlockGate & {
        slug: string
        profiles: { artist_slug: string } | null
      }
      await notifyRejection(admin, data, {
        ...gate,
        artistSlug: gate.profiles?.artist_slug ?? null,
      })
    }
  }
  redirect(`/review/${token}`)
}
