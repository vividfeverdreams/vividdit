"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

type VaultRescueResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

function rescueUrl(statusToken: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://vividdit.com").replace(
    /\/$/,
    ""
  )
  return `${base}/download/vault/${statusToken}`
}

export async function getVaultRescueLinkAction(
  vaultId: string,
  rotate = false
): Promise<VaultRescueResult> {
  if (!/^[0-9a-f-]{36}$/i.test(vaultId)) {
    return { ok: false, error: "Invalid vault." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to manage this link." }

  // The user-scoped client and creator_id filter enforce ownership before the
  // service-role client is allowed to mint a capability.
  const { data: vault } = await supabase
    .from("gates")
    .select("id, status")
    .eq("id", vaultId)
    .eq("creator_id", user.id)
    .eq("kind", "vault")
    .maybeSingle()
  if (!vault || vault.status !== "published") {
    return { ok: false, error: "Enable the vault before creating a rescue link." }
  }

  // The database function owns the status check, uniqueness constraint, and
  // advisory lock shared with vault disable, so create/rotate is one atomic
  // capability operation rather than a check-then-insert race.
  const { data: statusToken, error } = await supabase.rpc(
    "mint_vault_rescue_link",
    { p_vault_id: vault.id, p_rotate: rotate }
  )

  if (error || typeof statusToken !== "string") {
    console.error("[vault-rescue] creation failed", {
      vaultId: vault.id,
      code: error?.code,
    })
    return { ok: false, error: "Couldn't create the rescue link. Try again." }
  }

  revalidatePath("/dashboard")
  return { ok: true, url: rescueUrl(statusToken) }
}
