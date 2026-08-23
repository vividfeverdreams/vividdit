import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}))
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { getVaultRescueLinkAction } from "@/app/dashboard/vault-rescue-actions"

const VAULT_ID = "33333333-3333-4333-8333-333333333333"
const STATUS_TOKEN = "44444444-4444-4444-8444-444444444444"

function gateQuery(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function rescueClient({
  user = { id: "creator-1" } as { id: string } | null,
  vault = { id: VAULT_ID, status: "published" } as {
    id: string
    status: string
  } | null,
  rpcData = STATUS_TOKEN as string | null,
  rpcError = null as null | { code: string },
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError })
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue(gateQuery(vault)),
    rpc,
  }
}

describe("vault rescue link action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://artist.example/")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("mints the atomic rescue capability and returns a normalized URL", async () => {
    const client = rescueClient()
    mocks.createClient.mockResolvedValue(client)

    await expect(getVaultRescueLinkAction(VAULT_ID, true)).resolves.toEqual({
      ok: true,
      url: `https://artist.example/download/vault/${STATUS_TOKEN}`,
    })
    expect(client.rpc).toHaveBeenCalledWith("mint_vault_rescue_link", {
      p_vault_id: VAULT_ID,
      p_rotate: true,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard")
  })

  it("refuses to mint a link for a disabled vault", async () => {
    const client = rescueClient({
      vault: { id: VAULT_ID, status: "draft" },
    })
    mocks.createClient.mockResolvedValue(client)

    await expect(getVaultRescueLinkAction(VAULT_ID)).resolves.toEqual({
      ok: false,
      error: "Enable the vault before creating a rescue link.",
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("requires an authenticated artist", async () => {
    const client = rescueClient({ user: null })
    mocks.createClient.mockResolvedValue(client)

    await expect(getVaultRescueLinkAction(VAULT_ID)).resolves.toEqual({
      ok: false,
      error: "Sign in to manage this link.",
    })
    expect(client.from).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
