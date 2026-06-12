import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// Two-creator RLS isolation suite. Runs against the local Supabase stack;
// skipped automatically when the stack is down.

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY!

async function stackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${url()}/auth/v1/health`, {
      headers: { apikey: anonKey() },
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

const run = await stackUp()

describe.skipIf(!run)("RLS isolation", () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const emailA = `rls-a-${suffix}@test.dev`
  const emailB = `rls-b-${suffix}@test.dev`
  const password = "test-password-123"

  let admin: SupabaseClient
  let asA: SupabaseClient
  let asB: SupabaseClient
  let asAnon: SupabaseClient
  let userAId: string
  let userBId: string
  let publishedGateId: string

  beforeAll(async () => {
    admin = createClient(url(), serviceKey())
    asA = createClient(url(), anonKey())
    asB = createClient(url(), anonKey())
    asAnon = createClient(url(), anonKey())

    const a = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    })
    const b = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    })
    userAId = a.data.user!.id
    userBId = b.data.user!.id

    await asA.auth.signInWithPassword({ email: emailA, password })
    await asB.auth.signInWithPassword({ email: emailB, password })

    // A: one draft, one published gate.
    await asA.from("gates").insert({
      creator_id: userAId,
      title: "RLS Draft",
      artist: "A",
      soundcloud_url: "https://soundcloud.com/a/draft",
      slug: `rls-draft-${suffix}`,
    })
    const { data: pub } = await asA
      .from("gates")
      .insert({
        creator_id: userAId,
        title: "RLS Published",
        artist: "A",
        soundcloud_url: "https://soundcloud.com/a/pub",
        slug: `rls-pub-${suffix}`,
        status: "published",
      })
      .select("id")
      .single()
    publishedGateId = pub!.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.auth.admin.deleteUser(userAId).catch(() => {})
    await admin.auth.admin.deleteUser(userBId).catch(() => {})
  })

  it("signup trigger created profiles", async () => {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .in("id", [userAId, userBId])
    expect(data).toHaveLength(2)
  })

  it("creator sees own draft and published gates", async () => {
    const { data } = await asA
      .from("gates")
      .select("slug")
      .eq("creator_id", userAId)
    expect(data?.map((g) => g.slug).sort()).toEqual([
      `rls-draft-${suffix}`,
      `rls-pub-${suffix}`,
    ])
  })

  it("other creators and anon see only published gates", async () => {
    for (const client of [asB, asAnon]) {
      const { data } = await client
        .from("gates")
        .select("slug")
        .eq("creator_id", userAId)
      expect(data?.map((g) => g.slug)).toEqual([`rls-pub-${suffix}`])
    }
  })

  it("cross-creator updates are blocked", async () => {
    const { data } = await asB
      .from("gates")
      .update({ title: "hacked" })
      .eq("id", publishedGateId)
      .select()
    expect(data).toEqual([])
  })

  it("inserting a gate as someone else is blocked", async () => {
    const { error } = await asB.from("gates").insert({
      creator_id: userAId,
      title: "sneaky",
      artist: "B",
      soundcloud_url: "https://soundcloud.com/x",
      slug: `sneaky-${suffix}`,
    })
    expect(error?.code).toBe("42501")
  })

  it("creator_ai_keys is service-role only", async () => {
    await admin.from("creator_ai_keys").insert({
      creator_id: userAId,
      encrypted_key: "v1:test:test:test",
    })
    const { error: ownError } = await asA.from("creator_ai_keys").select("*")
    expect(ownError?.code).toBe("42501")
    const { error: anonError } = await asAnon.from("creator_ai_keys").select("*")
    expect(anonError?.code).toBe("42501")
  })

  it("download_tokens is service-role only", async () => {
    const { error } = await asA.from("download_tokens").select("*")
    expect(error?.code).toBe("42501")
  })

  it("slug is immutable after publish", async () => {
    const { error } = await asA
      .from("gates")
      .update({ slug: `renamed-${suffix}` })
      .eq("id", publishedGateId)
    expect(error?.message).toContain("immutable")
  })

  it("submissions on own gates are readable, others' are not", async () => {
    await admin.from("submissions").insert({
      gate_id: publishedGateId,
      proof_code: "GATE-TEST",
      email: "fan@test.dev",
      email_purpose: "fan_list",
    })
    const { data: own } = await asA
      .from("submissions")
      .select("id")
      .eq("gate_id", publishedGateId)
    expect(own).toHaveLength(1)
    const { data: other } = await asB
      .from("submissions")
      .select("id")
      .eq("gate_id", publishedGateId)
    expect(other).toEqual([])
  })
})
