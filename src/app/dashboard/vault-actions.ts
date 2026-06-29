"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

// The "Complete Vault" is one special gate per creator (kind = 'vault') that
// bundles their other gates' HQ files behind a single set of follow/email
// steps. It has no track of its own and no download_asset — delivery gathers
// every published `in_vault` single gate's file at download time.

export async function setVaultEnabledAction(formData: FormData) {
  const enabled = formData.get("enabled") === "true"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { data: vault } = await supabase
    .from("gates")
    .select("id")
    .eq("creator_id", user.id)
    .eq("kind", "vault")
    .maybeSingle()

  if (!enabled) {
    if (vault) {
      await supabase
        .from("gates")
        .update({ status: "archived" })
        .eq("id", vault.id)
        .eq("creator_id", user.id)
    }
    revalidatePath("/dashboard")
    return
  }

  // Enable: re-publish an existing vault, or create one.
  if (vault) {
    await supabase
      .from("gates")
      .update({ status: "published" })
      .eq("id", vault.id)
      .eq("creator_id", user.id)
    revalidatePath("/dashboard")
    return
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("artist_name, soundcloud_profile_url")
    .eq("id", user.id)
    .single()

  const insertVault = async (slug: string) =>
    supabase
      .from("gates")
      .insert({
        creator_id: user.id,
        kind: "vault",
        title: "The Complete Vault",
        artist: profile?.artist_name ?? "Vault",
        // The vault has no track; store the creator's profile to satisfy the
        // NOT NULL column (it is never embedded on the vault page).
        soundcloud_url:
          profile?.soundcloud_profile_url ?? "https://soundcloud.com",
        slug,
        status: "published",
        theme: { accentColor: "#6d28d9", backgroundColor: "#0a0a0a" },
      })
      .select("id")
      .single()

  let { data: gate, error } = await insertVault("vault")
  if (error?.code === "23505") {
    ;({ data: gate, error } = await insertVault("complete-vault"))
  }
  if (error || !gate) {
    revalidatePath("/dashboard")
    return
  }

  await supabase.from("gate_requirements").insert({
    gate_id: gate.id,
    email_enabled: true,
    soundcloud_enabled: false,
    require_like: false,
    require_repost: false,
    require_follow: false,
    require_proof_code: false,
    instagram_enabled: false,
    spotify_enabled: false,
  })

  revalidatePath("/dashboard")
}

export async function setGateInVault(gateId: string, included: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from("gates")
    .update({ in_vault: included })
    .eq("id", gateId)
    .eq("creator_id", user.id)
    .eq("kind", "single")

  revalidatePath("/dashboard")
}
