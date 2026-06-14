import { redirect } from "next/navigation"

import {
  approveSubmissionAction,
  rejectSubmissionAction,
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
import type { VerificationOutcome } from "@/lib/verification"

export const metadata = { title: "Reviews" }

type QueueItem = {
  id: string
  email: string | null
  proof_code: string
  created_at: string
  fraud_flags: unknown[]
  gateTitle: string
  decision: string | null
  outcome: VerificationOutcome | null
  runError: string | null
  images: { url: string; path: string }[]
}

export default async function ReviewsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, email, proof_code, created_at, fraud_flags, gates!inner(title, creator_id)"
    )
    .eq("status", "needs_review")
    .eq("gates.creator_id", user.id)
    .order("created_at", { ascending: true })

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

    const images: QueueItem["images"] = []
    for (const p of proofs ?? []) {
      const { data: signed } = await admin.storage
        .from("proofs")
        .createSignedUrl(p.storage_path, 600)
      if (signed) images.push({ url: signed.signedUrl, path: p.storage_path })
    }

    items.push({
      id: s.id,
      email: s.email,
      proof_code: s.proof_code,
      created_at: s.created_at,
      fraud_flags: (s.fraud_flags as unknown[]) ?? [],
      gateTitle: gate.title,
      decision: run?.decision ?? null,
      outcome: (run?.result as VerificationOutcome | null) ?? null,
      runError: run?.error ?? null,
      images,
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CardTitle>Queue is clear</CardTitle>
            <CardDescription>
              Submissions the AI can&apos;t decide land here for your call.
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
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>
              <CardDescription>
                {item.email ?? "No email left"} · code{" "}
                <span className="font-mono">{item.proof_code}</span>
                {item.fraud_flags.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {(item.fraud_flags as string[]).join(", ").replace(/_/g, " ")}
                  </Badge>
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
                <p className="rounded-lg border p-4 text-sm text-destructive">
                  AI verification didn&apos;t complete
                  {item.runError ? `: ${item.runError}` : "."}
                </p>
              )}

              <div className="flex gap-2">
                <form action={approveSubmissionAction}>
                  <input type="hidden" name="submissionId" value={item.id} />
                  <Button type="submit">Approve — send download</Button>
                </form>
                <form action={rejectSubmissionAction}>
                  <input type="hidden" name="submissionId" value={item.id} />
                  <Button type="submit" variant="destructive">
                    Reject — ask to resubmit
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
