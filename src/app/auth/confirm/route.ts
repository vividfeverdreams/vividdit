import { redirect } from "next/navigation"
import { type NextRequest } from "next/server"
import { type EmailOtpType } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"

// Target of the confirmation link in auth emails:
//   /auth/confirm?token_hash=...&type=email
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = searchParams.get("next") ?? "/get-access"

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      redirect(next)
    }
  }

  redirect("/auth/error")
}
