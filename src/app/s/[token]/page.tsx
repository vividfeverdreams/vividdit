import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
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
    body: "Your download is unlocked. (Download delivery arrives in Phase 7.)",
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
    .select("id, status, proof_code, created_at, gates(title, artist)")
    .eq("status_token", token)
    .maybeSingle()
  if (!submission) notFound()

  const gate = submission.gates as unknown as { title: string; artist: string }
  const copy = STATUS_COPY[submission.status] ?? STATUS_COPY.pending

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
          <p>
            Proof code:{" "}
            <span className="font-mono text-foreground">
              {submission.proof_code}
            </span>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
