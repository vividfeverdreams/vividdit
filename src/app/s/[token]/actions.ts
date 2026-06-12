"use server"

import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"

export type StatusEmailState = { error: string | null; saved: boolean }

// Status-only email: collected when the Email Gate is off but a manual review
// means the fan may leave before a decision. Never exported with fan lists
// (email_purpose = review_status).
export async function saveStatusEmailAction(
  _prev: StatusEmailState,
  formData: FormData
): Promise<StatusEmailState> {
  const token = formData.get("statusToken")
  const parsed = z.email("Enter a valid email").safeParse(formData.get("email"))
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) {
    return { error: "Something went wrong.", saved: false }
  }
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, saved: false }
  }

  const admin = createAdminClient()
  const { data: submission } = await admin
    .from("submissions")
    .select("id, email")
    .eq("status_token", token)
    .maybeSingle()
  if (!submission) {
    return { error: "Something went wrong.", saved: false }
  }
  if (submission.email) {
    return { error: null, saved: true }
  }

  const { error } = await admin
    .from("submissions")
    .update({ email: parsed.data, email_purpose: "review_status" })
    .eq("id", submission.id)
  if (error) {
    return { error: "Couldn't save your email.", saved: false }
  }
  return { error: null, saved: true }
}
