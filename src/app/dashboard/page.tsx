import Link from "next/link"

import { publishGate, setGateArchived } from "@/app/dashboard/actions"
import { setVaultEnabledAction } from "@/app/dashboard/vault-actions"
import { CopyUrlButton } from "@/app/dashboard/copy-url-button"
import { SortSelect } from "@/app/dashboard/sort-select"
import { VaultRescueLink } from "@/app/dashboard/vault-rescue-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
import { countAsks, HEAVY_GATE_ASKS } from "@/lib/gate-asks"
import { createClient } from "@/lib/supabase/server"
import {
  VAULT_RESCUE_PROOF_CODE,
  VAULT_RESCUE_USER_AGENT,
} from "@/lib/vault-rescue-constants"

export const metadata = { title: "Download Gates" }

const SORTS = ["newest", "oldest", "visits", "downloads", "archived"] as const
type Sort = (typeof SORTS)[number]

function StatusBadge({ status }: { status: string }) {
  if (status === "published") return <Badge>Published</Badge>
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>
  return <Badge variant="outline">Draft</Badge>
}

function coverUrl(g: {
  cover_path: string | null
  theme: { artworkUrl?: string | null } | null
}): string | null {
  if (g.cover_path) {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/${g.cover_path}`
  }
  return g.theme?.artworkUrl ?? null
}

export default async function GatesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const sp = await searchParams
  const sort: Sort = SORTS.includes(sp.sort as Sort) ? (sp.sort as Sort) : "newest"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: gatesRaw }, { data: profile }, { data: stats }] =
    await Promise.all([
      supabase
        .from("gates")
        .select(
          "id, title, artist, slug, status, created_at, cover_path, theme, kind, in_vault, gate_requirements(unlock_mode, email_enabled, require_like, require_repost), gate_follow_targets(id)"
        )
        .eq("creator_id", user!.id),
      supabase.from("profiles").select("artist_slug").eq("id", user!.id).single(),
      supabase.from("gate_stats").select("gate_id, views, downloads, emails"),
    ])

  const statById = new Map(
    (stats ?? []).map((s) => [
      s.gate_id,
      {
        views: Number(s.views ?? 0),
        downloads: Number(s.downloads ?? 0),
        emails: Number(s.emails ?? 0),
      },
    ])
  )
  const statFor = (id: string) =>
    statById.get(id) ?? { views: 0, downloads: 0, emails: 0 }

  type Req = {
    unlock_mode: string
    email_enabled: boolean
    require_like: boolean
    require_repost: boolean
  }
  const all = (gatesRaw ?? []).map((g) => {
    // gate_requirements is one-to-one; PostgREST may embed it as an object or
    // a one-item array depending on how it reads the constraint.
    const raw = g.gate_requirements as unknown
    const req = (Array.isArray(raw) ? raw[0] : raw) as Req | undefined
    const asks = req
      ? countAsks({
          emailEnabled: req.email_enabled,
          requireLike: req.require_like,
          requireRepost: req.require_repost,
          followCount: ((g.gate_follow_targets as unknown[]) ?? []).length,
        })
      : 0
    return {
      ...g,
      stat: statFor(g.id),
      verified: req?.unlock_mode === "verified",
      asks,
    }
  })

  // The vault is shown in its own card, not the gate list.
  const vault = all.find((g) => g.kind === "vault") ?? null
  const singles = all.filter((g) => g.kind === "single")

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://vividdit.com").replace(
    /\/$/,
    ""
  )
  let vaultRescueUrl: string | null = null
  if (vault?.status === "published") {
    const { data: rescue } = await supabase
      .from("submissions")
      .select("status_token")
      .eq("gate_id", vault.id)
      .eq("status", "approved")
      .eq("proof_code", VAULT_RESCUE_PROOF_CODE)
      .eq("user_agent", VAULT_RESCUE_USER_AGENT)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (rescue) {
      vaultRescueUrl = `${siteUrl}/download/vault/${rescue.status_token}`
    }
  }

  // "archived" is a filter; the rest are sorts over non-archived gates.
  const gates =
    sort === "archived"
      ? singles.filter((g) => g.status === "archived")
      : singles.filter((g) => g.status !== "archived")

  gates.sort((a, b) => {
    if (sort === "visits") return b.stat.views - a.stat.views
    if (sort === "downloads") return b.stat.downloads - a.stat.downloads
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    return sort === "oldest" ? ta - tb : tb - ta
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Download Gates</h1>
        <Button render={<Link href="/dashboard/gates/new" />} nativeButton={false}>
          New gate
        </Button>
      </div>

      {profile?.artist_slug && singles.some((g) => g.status === "published") && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Your artist page</p>
              <p className="text-sm text-muted-foreground">
                Every free download in one link, with the vault on top. Made for
                your bio.
              </p>
            </div>
            <div className="flex gap-2">
              <CopyUrlButton url={`${siteUrl}/${profile.artist_slug}`} />
              <Button
                size="sm"
                variant="outline"
                render={<a href={`/${profile.artist_slug}`} target="_blank" rel="noreferrer" />}
                nativeButton={false}
              >
                Open
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort</span>
        <SortSelect value={sort} />
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">The Complete Vault</p>
              <p className="text-sm text-muted-foreground">
                {vault?.status === "published"
                  ? "Fans complete your follow steps once to download every track in your vault."
                  : "Bundle all your tracks behind one set of follow steps — fans unlock everything at once."}
              </p>
            </div>
            {vault?.status === "published" ? (
              <div className="flex gap-2">
                <CopyUrlButton
                  url={`${siteUrl}/${profile?.artist_slug}/${vault.slug}`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={`/dashboard/gates/${vault.id}/edit`} />}
                  nativeButton={false}
                >
                  Customize
                </Button>
                <form action={setVaultEnabledAction}>
                  <input type="hidden" name="enabled" value="false" />
                  <Button size="sm" variant="ghost" type="submit">
                    Disable
                  </Button>
                </form>
              </div>
            ) : (
              <form action={setVaultEnabledAction}>
                <input type="hidden" name="enabled" value="true" />
                <Button size="sm" type="submit">
                  Enable the Vault
                </Button>
              </form>
            )}
          </div>
          {vault?.status === "published" && (
            <div className="space-y-2 border-t pt-3">
              <div>
                <p className="text-sm font-medium">Having upload trouble?</p>
                <p className="text-xs text-muted-foreground">
                  Send this unlocked rescue link after a fan reports an error.
                  Anyone with it can download the vault, so rotate it if it is
                  shared too widely. Previously opened file links can take up
                  to five minutes to expire.
                </p>
              </div>
              <VaultRescueLink
                vaultId={vault.id}
                initialUrl={vaultRescueUrl}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {!gates.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="space-y-2">
              <CardTitle>
                {sort === "archived" ? "No archived gates" : "No gates yet"}
              </CardTitle>
              <CardDescription>
                {sort === "archived"
                  ? "Gates you archive will show up here."
                  : "Create your first download gate to start turning free downloads into followers."}
              </CardDescription>
            </div>
            {sort !== "archived" && (
              <Button
                render={<Link href="/dashboard/gates/new" />}
                nativeButton={false}
              >
                Create your first gate
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {gates.map((g) => {
            const publicUrl = `${siteUrl}/${profile?.artist_slug}/${g.slug}`
            const cover = coverUrl(g)
            return (
              <li key={g.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4 py-4">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt=""
                        className="size-14 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="size-14 shrink-0 rounded-md bg-muted" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {g.artist} · /{profile?.artist_slug}/{g.slug}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {g.verified ? "Verified" : "Quick unlock"}
                        </Badge>
                        {g.asks > HEAVY_GATE_ASKS && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 text-amber-700 dark:text-amber-400"
                            title="Every extra step loses fans. Email plus two follows unlocks the most downloads."
                          >
                            {g.asks} asks: heavy
                          </Badge>
                        )}
                      </p>
                    </div>

                    <div className="flex gap-5 text-center text-sm">
                      <div>
                        <p className="font-semibold">{g.stat.views}</p>
                        <p className="text-xs text-muted-foreground">Visits</p>
                      </div>
                      <div>
                        <p className="font-semibold">{g.stat.downloads}</p>
                        <p className="text-xs text-muted-foreground">Downloads</p>
                      </div>
                      <div>
                        <p className="font-semibold">{g.stat.emails}</p>
                        <p className="text-xs text-muted-foreground">Emails</p>
                      </div>
                    </div>

                    <StatusBadge status={g.status} />

                    <div className="flex gap-2">
                      {g.status === "published" && <CopyUrlButton url={publicUrl} />}
                      {g.status !== "archived" && (
                        <Button
                          size="sm"
                          variant="outline"
                          render={<Link href={`/dashboard/gates/${g.id}/edit`} />}
                          nativeButton={false}
                        >
                          Edit
                        </Button>
                      )}
                      {g.status === "draft" && (
                        <form action={publishGate}>
                          <input type="hidden" name="gateId" value={g.id} />
                          <Button size="sm" type="submit">
                            Publish
                          </Button>
                        </form>
                      )}
                      <form action={setGateArchived}>
                        <input type="hidden" name="gateId" value={g.id} />
                        <input
                          type="hidden"
                          name="archive"
                          value={g.status === "archived" ? "false" : "true"}
                        />
                        <Button size="sm" variant="ghost" type="submit">
                          {g.status === "archived" ? "Restore" : "Archive"}
                        </Button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
