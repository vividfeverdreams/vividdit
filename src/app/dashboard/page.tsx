import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Download Gates" }

export default async function GatesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // RLS also lets authenticated users read other creators' *published* gates
  // (fan pages need that), so scope explicitly to the signed-in creator.
  const { data: gates } = await supabase
    .from("gates")
    .select("id, title, artist, slug, status, created_at")
    .eq("creator_id", user!.id)
    .order("created_at", { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Download Gates
        </h1>
        <Button disabled title="Gate builder arrives in Phase 4">
          New gate
        </Button>
      </div>

      {!gates?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CardTitle>No gates yet</CardTitle>
            <CardDescription>
              Create your first download gate to start turning free downloads
              into followers. (Gate builder arrives in Phase 4.)
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {gates.map((g) => (
            <li key={g.id}>
              <Card>
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="font-medium">{g.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {g.artist} · /{g.slug} · {g.status}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
