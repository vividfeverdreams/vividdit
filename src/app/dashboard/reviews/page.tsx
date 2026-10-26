import { redirect } from "next/navigation"

import {
  approveSubmissionAction,
  dismissUncheckedAction,
  rejectSubmissionAction,
  revokeSubmissionAction,
} from "@/app/dashboard/reviews/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { AUTO_APPROVE_HOURS, reviewAgeStart } from "@/lib/unlock"
import type { VerificationOutcome } from "@/lib/verification"

export const metadata = { title: "Reviews" }

// Flags are notes for the creator, not verdicts: friends share Wi-Fi, and fans
// retry after a failed upload.
const FLAG_NOTE: Record<string, string> = {
  repeat_ip: "Same network as an earlier try",
  repeat_email: "Same email as an earlier try",
  similar_screenshot: "Screenshot looks like another fan's",
  ai_unavailable: "AI check couldn't run",
  revoked: "Access revoked",
}

type QueueItem = {
  id: string
  email: string | null
  proof_code: string
  created_at: string
  review_started_at: string | null
  unlocked: boolean
  flags: string[]
  gateTitle: string
  decision: string | null
  outcome: VerificationOutcome | null
  runError: string | null
  images: { url: string; path: string }[]
}

async function signedProofs(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[]
): Promise<{ url: string; path: string }[]> {
  if (paths.length === 0) return []
  const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 600)
  return (data ?? []).flatMap((item) =>
    item.signedUrl && item.path ? [{ url: item.signedUrl, path: item.path }] : []
  )
}

function twoWeeksAgo(): string {
  return new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
}

function autoApproveLabel(item: QueueItem): string {
  const due =
    reviewAgeStart(item) + AUTO_APPROVE_HOURS * 3600 * 1000 - Date.now()
  if (due <= 0) return "Auto-approves at the next check"
  const hours = Math.ceil(due / 3600_000)
  return `Auto-approves in ${hours} h`
}

export default async function ReviewsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [{ data: submissions }, { data: unchecked }] = await Promise.all([
    supabase
      .from("submissions")
      .select(
        "id, email, proof_code, created_at, review_started_at, unlocked_at, fraud_flags, gates!inner(title, creator_id)"
      )
      .eq("status", "needs_review")
      .eq("gates.creator_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("submissions")
      .select(
        "id, email, decided_at, fraud_flags, proof_images(storage_path), gates!inner(title, creator_id)"
      )
      .eq("status", "approved")
      .eq("gates.creator_id", user.id)
      // fraud_flags is jsonb: pass the containment value as JSON text.
      .filter("fraud_flags", "cs", JSON.stringify(["ai_unavailable"]))
      .gte("decided_at", twoWeeksAgo())
      .order("decided_at", { ascending: false })
      .limit(50),
  ])

  const admin = createAdminClient()
  const items: QueueItem[] = []
  for (const s of submissions ?? []) {
    const gate = s.gates as unknown as { title: string }

    const [{ data: run }, { data: proofs }] = await Promise.all([
      supabase
        .from("verification_runs")
        .select("result, error, decision")
        .eq("submission_id", s.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("proof_images")
        .select("storage_path")
        .eq("submission_id", s.id)
        .order("created_at", { ascending: true }),
    ])

    items.push({
      id: s.id,
      email: s.email,
      proof_code: s.proof_code,
      created_at: s.created_at,
      review_started_at: s.review_started_at,
      unlocked: !!s.unlocked_at,
      flags: (s.fraud_flags as string[]) ?? [],
      gateTitle: gate.title,
      decision: run?.decision ?? null,
      outcome: (run?.result as VerificationOutcome | null) ?? null,
      runError: run?.error ?? null,
      images: await signedProofs(
        admin,
        (proofs ?? []).map((p) => p.storage_path)
      ),
    })
  }

  const uncheckedItems = await Promise.all(
    (unchecked ?? []).map(async (s) => ({
      id: s.id,
      email: s.email,
      decided_at: s.decided_at as string,
      gateTitle: (s.gates as unknown as { title: string }).title,
      images: await signedProofs(
        admin,
        ((s.proof_images as { storage_path: string }[] | null) ?? []).map(
          (p) => p.storage_path
        )
      ),
    }))
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Screenshots the AI wasn&apos;t sure about. Anything you don&apos;t
          decide is approved automatically {AUTO_APPROVE_HOURS} hours after it
          arrived, and the fan gets their download by email.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CardTitle>Queue is clear</CardTitle>
            <CardDescription>
              Only Verified gates send fans here, when the AI can&apos;t decide.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{item.gateTitle}</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()} ·{" "}
                  {autoApproveLabel(item)}
                </span>
              </div>
              <CardDescription className="space-y-2">
                <span className="block">
                  {item.email ?? "No email left"} · code{" "}
                  <span className="font-mono">{item.proof_code}</span> ·{" "}
                  {item.unlocked
                    ? "already has the download"
                    : "waiting for the download"}
                </span>
                {item.flags.length > 0 && (
                  <span className="flex flex-wrap gap-1.5">
                    {item.flags.map((flag) => (
                      <Badge key={flag} variant="secondary">
                        {FLAG_NOTE[flag] ?? flag.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {item.images.map((img) => (
                  <a key={img.path} href={img.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt="Proof screenshot"
                      className="h-40 rounded-lg border object-contain"
                    />
                  </a>
                ))}
              </div>

              {item.outcome ? (
                <div className="space-y-2 rounded-lg border p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">AI: {item.decision ?? "review"}</Badge>
                    <span className="text-muted-foreground">
                      confidence {Math.round(item.outcome.confidence * 100)}%
                    </span>
                    {item.outcome.tampering_suspected && (
                      <Badge variant="destructive">tampering suspected</Badge>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {item.outcome.results.map((r, i) => (
                      <li
                        key={i}
                        className={r.confirmed ? "text-foreground" : "text-destructive"}
                      >
                        {r.confirmed ? "✓" : "✗"} {r.label}
                        {!r.confirmed && r.note ? ` — ${r.note}` : ""}
                      </li>
                    ))}
                  </ul>
                  {item.outcome.fan_message && (
                    <p className="text-muted-foreground">
                      AI note to fan: “{item.outcome.fan_message}”
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                  The AI check didn&apos;t complete
                  {item.runError ? `: ${item.runError}` : "."}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <form action={approveSubmissionAction}>
                  <input type="hidden" name="submissionId" value={item.id} />
                  <Button type="submit" size="lg">
                    {item.unlocked ? "Approve" : "Approve — send download"}
                  </Button>
                </form>
                <form action={rejectSubmissionAction}>
                  <input type="hidden" name="submissionId" value={item.id} />
                  <Button type="submit" size="lg" variant="outline">
                    Reject — ask to resubmit
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {uncheckedItems.length > 0 && (
        <section className="space-y-3 pt-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Let through without a check
            </h2>
            <p className="text-sm text-muted-foreground">
              Your AI key couldn&apos;t run, so these fans got their download
              without a screenshot check (last 14 days). Take a look when you
              can.
            </p>
          </div>
          {uncheckedItems.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.gateTitle}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {item.email ?? "No email"} ·{" "}
                    {new Date(item.decided_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {item.images.map((img) => (
                    <a key={img.path} href={img.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt="Proof screenshot"
                        className="size-14 rounded-md border object-cover"
                      />
                    </a>
                  ))}
                </div>
                <div className="flex gap-2">
                  <form action={dismissUncheckedAction}>
                    <input type="hidden" name="submissionId" value={item.id} />
                    <Button type="submit" variant="outline">
                      Looks fine
                    </Button>
                  </form>
                  <form action={revokeSubmissionAction}>
                    <input type="hidden" name="submissionId" value={item.id} />
                    <Button type="submit" variant="ghost">
                      Revoke access
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  )
}
