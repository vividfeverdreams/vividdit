"use server"

import { revalidatePath } from "next/cache"

import { hasValidOpenAiKey } from "@/lib/ai-keys"
import { createClient } from "@/lib/supabase/server"

export async function setGateArchived(formData: FormData) {
  const gateId = formData.get("gateId")
  const archive = formData.get("archive") === "true"
  if (typeof gateId !== "string") return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  // RLS limits this to the creator's own gates; status flows back to draft on
  // unarchive (re-publishing keeps the original slug + published_at).
  await supabase
    .from("gates")
    .update({ status: archive ? "archived" : "draft" })
    .eq("id", gateId)
    .eq("creator_id", user.id)

  revalidatePath("/dashboard")
}

export async function publishGate(formData: FormData) {
  const gateId = formData.get("gateId")
  if (typeof gateId !== "string") return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  // Same publish guards as the wizard: an HQ file must exist, and SoundCloud
  // gates need a valid OpenAI key.
  const [{ data: asset }, { data: req }] = await Promise.all([
    supabase
      .from("download_assets")
      .select("id")
      .eq("gate_id", gateId)
      .maybeSingle(),
    supabase
      .from("gate_requirements")
      .select("soundcloud_enabled")
      .eq("gate_id", gateId)
      .maybeSingle(),
  ])
  if (!asset) return
  if (req?.soundcloud_enabled && !(await hasValidOpenAiKey(user.id))) return

  await supabase
    .from("gates")
    .update({ status: "published" })
    .eq("id", gateId)
    .eq("creator_id", user.id)

  revalidatePath("/dashboard")
}
