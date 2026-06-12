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
  required: {
    like: boolean
    repost: boolean
    follow: boolean
    proofCode: boolean
  }
  outcome: VerificationOutcome | null
  runError: string | null
  images: { url: string; path: string }[]
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "text-foreground" : "text-destructive"}>
      {ok ? "✓" : "✗"} {label}
    </span>
  )
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
      "id, email, proof_code, created_at, fraud_flags, gates!inner(title, creator_id, gate_requirements(require_like, require_repost, require_follow, require_proof_code))"
    )
    .eq("status", "needs_review")
    .eq("gates.creator_id", user.id)
    .order("created_at", { ascending: true })

  const admin = createAdminClient()
  const items: QueueItem[] = []
  for (const s of submissions ?? []) {
    const gate = s.gates as unknown as {
      title: string
      gate_requirements: {
        require_like: boolean
        require_repost: boolean
        require_follow: boolean
        require_proof_code: boolean
      } | null
    }

    const [{ data: run }, { data: proofs }] = await Promise.all([
      supabase
        .from("verification_runs")
        .select("result, error")
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
      required: {
        like: gate.gate_requirements?.require_like ?? false,
        repost: gate.gate_requirements?.require_repost ?? false,
        follow: gate.gate_requirements?.require_follow ?? false,
        proofCode: gate.gate_requirements?.require_proof_code ?? false,
      },
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
                  <a
                    key={img.path}
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                  >
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
                    <Badge
                      variant={
                        item.outcome.decision === "approve"
                          ? "default"
                          : item.outcome.decision === "reject"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      AI: {item.outcome.decision}
                    </Badge>
                    <span className="text-muted-foreground">
                      confidence {Math.round(item.outcome.confidence * 100)}%
                    </span>
                    {item.outcome.tampering_suspected && (
                      <Badge variant="destructive">tampering suspected</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Check ok={item.outcome.track_match} label="track" />
                    <Check ok={item.outcome.artist_match} label="artist" />
                    {item.required.like && (
                      <Check ok={item.outcome.like_confirmed} label="like" />
                    )}
                    {item.required.repost && (
                      <Check ok={item.outcome.repost_confirmed} label="repost" />
                    )}
                    {item.required.follow && (
                      <Check ok={item.outcome.follow_confirmed} label="follow" />
                    )}
                    {item.required.proofCode && (
                      <Check ok={item.outcome.proof_code_visible} label="code" />
                    )}
                  </div>
                  {item.outcome.missing_requirements.length > 0 && (
                    <p className="text-muted-foreground">
                      Missing: {item.outcome.missing_requirements.join("; ")}
                    </p>
                  )}
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
