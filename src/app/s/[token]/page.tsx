import { notFound } from "next/navigation"

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

export const metadata = { title: "Download status" }

const STATUS_COPY: Record<string, { badge: string; title: string; body: string }> = {
  pending: {
    badge: "Verifying",
    title: "We're checking your proof",
    body: "Verification usually takes under a minute. Refresh this page to see the latest status.",
  },
  verifying: {
    badge: "Verifying",
    title: "We're checking your proof",
    body: "Verification usually takes under a minute. Refresh this page to see the latest status.",
  },
  needs_review: {
    badge: "In review",
    title: "The artist is taking a look",
    body: "Your submission needs a quick manual review. If you left an email, you'll get your download link there once approved.",
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
  const { data: submission } = await admin
    .from("submissions")
    .select(
      "id, status, proof_code, created_at, gates(title, artist, gate_requirements(require_proof_code, soundcloud_enabled))"
    )
    .eq("status_token", token)
    .maybeSingle()
  if (!submission) notFound()

  const gate = submission.gates as unknown as {
    title: string
    artist: string
    gate_requirements: {
      require_proof_code: boolean
      soundcloud_enabled: boolean
    } | null
  }
  const showProofCode =
    !!gate.gate_requirements?.soundcloud_enabled &&
    !!gate.gate_requirements?.require_proof_code
  const copy = STATUS_COPY[submission.status] ?? STATUS_COPY.pending

  // Surface the AI's explanation so rejected fans know what to fix.
  let fanMessage: string | null = null
  if (["rejected", "needs_review"].includes(submission.status)) {
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
                submission.status === "approved"
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
          <p>{copy.body}</p>
          {fanMessage && (
            <p className="rounded-lg border p-3 text-foreground">{fanMessage}</p>
          )}
          {submission.status === "approved" && (
            <Button
              render={<a href={`/download/by-status/${token}`} />}
              nativeButton={false}
              className="w-full"
            >
              Download the HQ file
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
        </CardContent>
      </Card>
    </main>
  )
}
