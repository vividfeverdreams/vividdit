import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  r2DownloadUrl: vi.fn(),
  r2DownloadUrls: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock("@/lib/storage", () => ({
  r2DownloadUrl: mocks.r2DownloadUrl,
  r2DownloadUrls: mocks.r2DownloadUrls,
}))

import { getVaultDownloads } from "@/lib/downloads"
import {
  VAULT_RESCUE_PROOF_CODE,
  VAULT_RESCUE_USER_AGENT,
} from "@/lib/vault-rescue-constants"

const STATUS_TOKEN = "55555555-5555-4555-8555-555555555555"

function queryWithMaybeSingle(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function queryWithOrder(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function adminFor({
  proofCode = null as string | null,
  userAgent = null as string | null,
  signingData = [
    {
      path: "creator/song.wav",
      signedUrl: "https://storage.example/signed?token=test",
      error: null,
    },
  ] as unknown,
  signingError = null as null | { message: string },
  gatesData = undefined as unknown,
  gatesError = null as null | { message: string },
} = {}) {
  const submission = {
    id: "submission-1",
    gate_id: "vault-1",
    status: "approved",
    proof_code: proofCode,
    user_agent: userAgent,
    gates: { creator_id: "creator-1", kind: "vault", status: "published" },
  }
  const gates = gatesData ?? [
    {
      title: "Song",
      created_at: "2026-08-23T00:00:00.000Z",
      download_assets: {
        storage_path: "creator/song.wav",
        filename: "Song HQ.wav",
        storage_provider: "supabase",
      },
    },
  ]
  const insertEvent = vi.fn().mockResolvedValue({ error: null })
  const createSignedUrls = vi
    .fn()
    .mockResolvedValue({ data: signingData, error: signingError })
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "submissions") return queryWithMaybeSingle(submission)
      if (table === "gates") return queryWithOrder(gates, gatesError)
      if (table === "events") return { insert: insertEvent }
      throw new Error(`Unexpected table: ${table}`)
    }),
    storage: {
      from: vi.fn().mockReturnValue({ createSignedUrls }),
    },
  }
  return { admin, createSignedUrls, insertEvent }
}

describe("vault download signing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.r2DownloadUrls.mockResolvedValue([])
  })

  it("fails closed when the storage provider cannot sign every file", async () => {
    const { admin, insertEvent } = adminFor({
      signingData: null,
      signingError: { message: "storage unavailable" },
    })
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(getVaultDownloads(STATUS_TOKEN)).rejects.toThrow(
      "Couldn't sign vault files: storage unavailable"
    )
    expect(insertEvent).not.toHaveBeenCalled()
  })

  it("fails closed when the vault asset query fails", async () => {
    const { admin, insertEvent } = adminFor({
      gatesData: null,
      gatesError: { message: "database unavailable" },
    })
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(getVaultDownloads(STATUS_TOKEN)).rejects.toThrow(
      "Couldn't load the vault files: database unavailable"
    )
    expect(insertEvent).not.toHaveBeenCalled()
  })

  it("does not count an empty published vault as a download", async () => {
    const { admin, insertEvent } = adminFor({ gatesData: [] })
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(getVaultDownloads(STATUS_TOKEN)).resolves.toEqual([])
    expect(insertEvent).not.toHaveBeenCalled()
  })

  it("returns downloadable URLs and records a normal fan conversion", async () => {
    const { admin, insertEvent, createSignedUrls } = adminFor()
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(getVaultDownloads(STATUS_TOKEN)).resolves.toEqual([
      {
        title: "Song",
        filename: "Song HQ.wav",
        url: "https://storage.example/signed?token=test&download=Song%20HQ.wav",
      },
    ])
    expect(createSignedUrls).toHaveBeenCalledWith(["creator/song.wav"], 300)
    expect(insertEvent).toHaveBeenCalledWith({
      gate_id: "vault-1",
      submission_id: "submission-1",
      event_type: "download",
    })
  })

  it("does not inflate analytics for an artist rescue capability", async () => {
    const { admin, insertEvent } = adminFor({
      proofCode: VAULT_RESCUE_PROOF_CODE,
      userAgent: VAULT_RESCUE_USER_AGENT,
    })
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(getVaultDownloads(STATUS_TOKEN)).resolves.toHaveLength(1)
    expect(insertEvent).not.toHaveBeenCalled()
  })

  it("requires both rescue sentinels before suppressing analytics", async () => {
    const { admin, insertEvent } = adminFor({
      proofCode: VAULT_RESCUE_PROOF_CODE,
      userAgent: "fan browser",
    })
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(getVaultDownloads(STATUS_TOKEN)).resolves.toHaveLength(1)
    expect(insertEvent).toHaveBeenCalledOnce()
  })
})
