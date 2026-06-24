import { notFound, redirect } from "next/navigation"

import { GateEditor } from "@/app/dashboard/gates/[id]/edit/editor"
import { hasValidAiKey } from "@/lib/ai-keys"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Edit gate" }

export default async function EditGatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: gate } = await supabase
    .from("gates")
    .select("id, title, artist, status, theme, cover_path")
    .eq("id", id)
    .eq("creator_id", user.id)
    .maybeSingle()
  if (!gate) notFound()

  const [{ data: req }, { data: targets }, validKey] = await Promise.all([
    supabase
      .from("gate_requirements")
      .select("email_enabled, require_like, require_repost, require_proof_code")
      .eq("gate_id", id)
      .maybeSingle(),
    supabase
      .from("gate_follow_targets")
      .select("platform, profile_url, sort_order")
      .eq("gate_id", id)
      .order("sort_order", { ascending: true }),
    hasValidAiKey(user.id),
  ])

  const theme = (gate.theme ?? {}) as {
    accentColor?: string
    backgroundColor?: string
    artworkUrl?: string
  }
  const coverUrl = gate.cover_path
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/${gate.cover_path}`
    : (theme.artworkUrl ?? null)

  const follows = (targets ?? []).filter((t) => t.profile_url)
  const byPlatform = (p: string) =>
    follows.filter((t) => t.platform === p).map((t) => t.profile_url)

  return (
    <GateEditor
      gateId={gate.id}
      status={gate.status}
      title={gate.title}
      artist={gate.artist}
      coverUrl={coverUrl}
      hasValidKey={validKey}
      initial={{
        accentColor: theme.accentColor ?? "#18181b",
        backgroundColor: theme.backgroundColor ?? "#0a0a0a",
        emailEnabled: req?.email_enabled ?? true,
        requireLike: req?.require_like ?? false,
        requireRepost: req?.require_repost ?? false,
        requireProofCode: req?.require_proof_code ?? false,
        scFollows: byPlatform("soundcloud"),
        igFollows: byPlatform("instagram"),
        spFollows: byPlatform("spotify"),
      }}
    />
  )
}
