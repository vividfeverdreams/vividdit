import Link from "next/link"
import { redirect } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Fans" }

export default async function FansPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Fan-list emails only — review_status addresses are notification-only and
  // never appear here or in exports.
  const { data: fans } = await supabase
    .from("submissions")
    .select("email, email_consent, status, created_at, gates!inner(title, creator_id)")
    .eq("gates.creator_id", user.id)
    .eq("email_purpose", "fan_list")
    .not("email", "is", null)
    .order("created_at", { ascending: false })

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Fans</h1>
        {!!fans?.length && (
          <Button
            render={<Link href="/dashboard/fans/export" prefetch={false} />}
            nativeButton={false}
            variant="outline"
          >
            Export CSV
          </Button>
        )}
      </div>

      {!fans?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CardTitle>No fans yet</CardTitle>
            <CardDescription>
              Emails collected by your gates show up here.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Gate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fans.map((f, i) => {
                  const gate = f.gates as unknown as { title: string }
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{f.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {gate.title}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            f.status === "approved" ? "default" : "secondary"
                          }
                        >
                          {f.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(f.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
