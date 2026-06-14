"use server"

import {
  verifyCreatorInstagramFollow,
  type AccessCheck,
} from "@/lib/creator-access"
import { createClient } from "@/lib/supabase/server"

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = ["image/jpeg", "image/png", "image/webp"]

export async function submitAccessProofAction(
  _prev: AccessCheck,
  formData: FormData
): Promise<AccessCheck> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { confirmed: false, message: "Please log in again." }

  const files = formData
    .getAll("proofs")
    .filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return { confirmed: false, message: "Upload a screenshot to continue." }
  }
  if (files.length > 3) {
    return { confirmed: false, message: "Up to 3 screenshots." }
  }

  const images: { mime: string; b64: string }[] = []
  for (const f of files) {
    if (!ALLOWED.includes(f.type)) {
      return { confirmed: false, message: "Use a JPG, PNG, or WEBP image." }
    }
    if (f.size > MAX_BYTES) {
      return { confirmed: false, message: `${f.name} is over 10MB.` }
    }
    images.push({
      mime: f.type,
      b64: Buffer.from(await f.arrayBuffer()).toString("base64"),
    })
  }

  const result = await verifyCreatorInstagramFollow(images)
  if (result.confirmed) {
    await supabase
      .from("profiles")
      .update({ access_unlocked_at: new Date().toISOString() })
      .eq("id", user.id)
  }
  return result
}
