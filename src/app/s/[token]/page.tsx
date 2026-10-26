import { notFound } from "next/navigation"

import { ResubmitForm } from "@/app/s/[token]/resubmit-form"
import { StatusEmailForm } from "@/app/s/[token]/status-email-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { hasDownloadAccess } from "@/lib/downloads"
import { createAdminClient } from "@/lib/supabase/admin"
import { approveSubmission, isStaleReview } from "@/lib/unlock"

export const metadata = { title: "Download status" }

const STATUS_COPY: Record<string, { badge: string; title: string; body: string }> = {
  pending: {
    badge: "Not finished",
    title: "You're almost there",
    body: "Go back to the download page to finish the steps.",
  },
  verifying: {
    badge: "Checking",
    title: "We're checking your screenshots",
    body: "This usually takes under a minute. Refresh this page to see the latest status.",
  },
  needs_review: {
    badge: "In review",
    title: "The artist is taking a look",
    body: "Your screenshots need a quick look from the artist, within 24 hours at most. If you left an email, the link comes there too.",
  },
  approved: {
    badge: "Approved",
    title: "You're in!",
    body: "Your download is unlocked — grab the HQ file below.",
  },
  rejected: {
    badge: "Not approved",
    title: "We couldn't verify your proof",
    body: "Go back to the gate page and submit clearer screenshots showing the required actions.",
  },
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // Token format guard before hitting the DB (status_token is a uuid).
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound()

  const admin = createAdminClient()
  const { data: found } = await admin
    .from("submissions")
    .select(
      "id, status, unlocked_at, review_started_at, proof_code, email, created_at, fraud_flags, gates(title, artist, kind, gate_requirements(require_proof_code, soundcloud_enabled))"
    )
    .eq("status_token", token)
    .maybeSingle()
  if (!found) notFound()

  // A review that has waited past the 24-hour window is approved on the spot.
  const submission =
    isStaleReview(found) &&
    (await approveSubmission(admin, found.id, ["needs_review"]))
      ? { ...found, status: "approved" }
      : found
  const canDownload = hasDownloadAccess(submission)

  const gate = submission.gates as unknown as {
    title: string
    artist: string
    kind: string
    gate_requirements: {
      require_proof_code: boolean
      soundcloud_enabled: boolean
    } | null
  }
  const showProofCode =
    !!gate.gate_requirements?.soundcloud_enabled &&
    !!gate.gate_requirements?.require_proof_code
  const copy =
    canDownload && submission.status !== "approved"
      ? STATUS_COPY.approved
      : (STATUS_COPY[submission.status] ?? STATUS_COPY.pending)
  const isVault = gate.kind === "vault"

  // Surface the AI's explanation so rejected fans know what to fix.
  let fanMessage: string | null = null
  if (submission.status === "rejected") {
    const { data: run } = await admin
      .from("verification_runs")
      .select("result")
      .eq("submission_id", submission.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const result = run?.result as { fan_message?: string } | null
    fanMessage = result?.fan_message || null
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{copy.title}</CardTitle>
            <Badge
              variant={
                canDownload
                  ? "default"
                  : submission.status === "rejected"
                    ? "destructive"
                    : "secondary"
              }
            >
              {copy.badge}
            </Badge>
          </div>
          <CardDescription>
            {gate.title} · {gate.artist}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {canDownload && isVault
              ? "Your vault is unlocked — open it below to download any track."
              : copy.body}
          </p>
          {fanMessage && (
            <p className="rounded-lg border p-3 text-foreground">{fanMessage}</p>
          )}
          {canDownload && (
            <Button
              render={
                <a
                  href={
                    isVault
                      ? `/download/vault/${token}`
                      : `/download/by-status/${token}`
                  }
                />
              }
              nativeButton={false}
              className="w-full"
            >
              {isVault ? "Open your vault" : "Download the HQ file"}
            </Button>
          )}
          {showProofCode && (
            <p>
              Proof code:{" "}
              <span className="font-mono text-foreground">
                {submission.proof_code}
              </span>
            </p>
          )}
          {submission.status === "rejected" &&
            !((submission.fraud_flags as string[] | null) ?? []).includes("revoked") && (
              <ResubmitForm submissionId={submission.id} statusToken={token} />
            )}
          {submission.status === "needs_review" && !submission.email && (
            <StatusEmailForm statusToken={token} />
          )}
        </CardContent>
      </Card>
    </main>
  )
}
