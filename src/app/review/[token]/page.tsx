import type { Metadata } from "next"
import Link from "next/link"

import { decideFromLinkAction } from "@/app/review/[token]/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { verifyReviewToken } from "@/lib/review-links"
import { createAdminClient } from "@/lib/supabase/admin"
import type { VerificationOutcome } from "@/lib/verification"

export const metadata: Metadata = {
  title: "Review a fan",
  robots: { index: false, follow: false },
}

const DECIDED: Record<string, string> = {
  approved: "Approved. The fan has their download.",
  rejected: "Rejected. The fan was asked to send clearer screenshots.",
}

export default async function ReviewLinkPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const submissionId = verifyReviewToken(token)

  if (!submissionId) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle>This link has expired</CardTitle>
          <CardDescription>
            Open Reviews in your dashboard to decide instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/dashboard/reviews" />} nativeButton={false}>
            Open Reviews
          </Button>
        </CardContent>
      </Shell>
    )
  }

  const admin = createAdminClient()
  const [{ data: submission }, { data: run }, { data: proofs }] = await Promise.all([
    admin
      .from("submissions")
      .select("id, status, email, created_at, gates(title)")
      .eq("id", submissionId)
      .maybeSingle(),
    admin
      .from("verification_runs")
      .select("result, error")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("proof_images")
      .select("storage_path")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: true }),
  ])
  if (!submission) {
    return (
      <Shell>
        <CardHeader>
          <CardTitle>Submission not found</CardTitle>
        </CardHeader>
      </Shell>
    )
  }

  const gateTitle = (submission.gates as unknown as { title: string }).title
  const outcome = (run?.result as VerificationOutcome | null) ?? null
  const paths = (proofs ?? []).map((p) => p.storage_path)
  const { data: signed } = paths.length
    ? await admin.storage.from("proofs").createSignedUrls(paths, 600)
    : { data: [] }

  return (
    <Shell>
      <CardHeader>
        <CardTitle>{gateTitle}</CardTitle>
        <CardDescription>
          {submission.email ?? "No email left"} ·{" "}
          {new Date(submission.created_at).toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(signed ?? []).map((img) =>
            img.signedUrl ? (
              <a key={img.path} href={img.signedUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.signedUrl}
                  alt="Proof screenshot"
                  className="aspect-[9/16] w-full rounded-lg border object-cover"
                />
              </a>
            ) : null
          )}
        </div>

        {outcome ? (
          <ul className="space-y-1 rounded-lg border p-3 text-sm">
            {outcome.results.map((r, i) => (
              <li key={i} className={r.confirmed ? "" : "text-destructive"}>
                {r.confirmed ? "✓" : "✗"} {r.label}
                {!r.confirmed && r.note ? ` — ${r.note}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          run?.error && (
            <p className="rounded-lg border p-3 text-sm text-muted-foreground">
              The AI check didn&apos;t complete: {run.error}
            </p>
          )
        )}

        {submission.status === "needs_review" ? (
          <form action={decideFromLinkAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" name="decision" value="approve" size="lg" className="h-12">
              Approve
            </Button>
            <Button
              type="submit"
              name="decision"
              value="reject"
              size="lg"
              variant="outline"
              className="h-12"
            >
              Reject
            </Button>
          </form>
        ) : (
          <p className="flex items-center gap-2 text-sm">
            <Badge variant="secondary">Decided</Badge>
            {DECIDED[submission.status] ?? "Already handled."}
          </p>
        )}
      </CardContent>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-10">
      <Card>{children}</Card>
    </main>
  )
}
