import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  mintDownloadToken: vi.fn(),
  sendDownloadEmail: vi.fn(),
  sendRejectionEmail: vi.fn(),
  sendVaultDownloadEmail: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock("@/lib/downloads", () => ({
  mintDownloadToken: mocks.mintDownloadToken,
}))
vi.mock("@/lib/email", () => ({
  sendDownloadEmail: mocks.sendDownloadEmail,
  sendRejectionEmail: mocks.sendRejectionEmail,
  sendVaultDownloadEmail: mocks.sendVaultDownloadEmail,
}))
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { approveSubmissionAction } from "@/app/dashboard/reviews/actions"

const STATUS_TOKEN = "22222222-2222-4222-8222-222222222222"

function queryReturning(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  query.select.mockReturnValue(query)
  query.update.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function submission(kind: "single" | "vault") {
  return {
    id: "submission-1",
    gate_id: "gate-1",
    status: "needs_review",
    status_token: STATUS_TOKEN,
    email: "fan@example.test",
    gates: {
      title: kind === "vault" ? "The Complete Vault" : "New Single",
      artist: "Test Artist",
      slug: "release",
      kind,
      creator_id: "creator-1",
      profiles: { artist_slug: "test-artist" },
    },
  }
}

// A chainable stand-in for the service-role client: updates resolve, the
// download-email claim succeeds, and inserts are recorded per table.
function adminClient() {
  const inserts: { table: string; payload: unknown }[] = []
  const updates: { table: string; payload: unknown }[] = []
  const admin = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {}
      Object.assign(builder, {
        update: vi.fn((payload: unknown) => {
          updates.push({ table, payload })
          return builder
        }),
        insert: vi.fn((payload: unknown) => {
          inserts.push({ table, payload })
          return Promise.resolve({ error: null })
        }),
        eq: vi.fn(() => builder),
        is: vi.fn(() => builder),
        select: vi.fn(() => builder),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "submission-1" }, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
      })
      return builder
    }),
  }
  return { admin, inserts, updates }
}

function arrangeApproval(kind: "single" | "vault") {
  const loadQuery = queryReturning(submission(kind))
  const updateQuery = queryReturning({ id: "submission-1" })
  const loadClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "creator-1" } } }) },
    from: vi.fn().mockReturnValue(loadQuery),
  }
  const updateClient = { from: vi.fn().mockReturnValue(updateQuery) }
  const { admin, inserts, updates } = adminClient()

  mocks.createClient
    .mockResolvedValueOnce(loadClient)
    .mockResolvedValueOnce(updateClient)
  mocks.createAdminClient.mockReturnValue(admin)
  return { inserts, updates, updateQuery }
}

function approvalForm() {
  const form = new FormData()
  form.set("submissionId", "submission-1")
  return form
}

describe("manual review approval delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mintDownloadToken.mockResolvedValue("single-download-token")
    mocks.sendDownloadEmail.mockResolvedValue(true)
    mocks.sendVaultDownloadEmail.mockResolvedValue(true)
  })

  it("emails the durable vault page and does not mint a single-file token", async () => {
    const { inserts, updates } = arrangeApproval("vault")

    await approveSubmissionAction(approvalForm())

    expect(mocks.sendVaultDownloadEmail).toHaveBeenCalledWith({
      creatorId: "creator-1",
      to: "fan@example.test",
      gateTitle: "The Complete Vault",
      artist: "Test Artist",
      statusToken: STATUS_TOKEN,
      idempotencyKey: "download-submission-1",
    })
    expect(mocks.mintDownloadToken).not.toHaveBeenCalled()
    expect(mocks.sendDownloadEmail).not.toHaveBeenCalled()
    expect(inserts).toContainEqual({
      table: "events",
      payload: {
        gate_id: "gate-1",
        submission_id: "submission-1",
        event_type: "approve",
      },
    })
    // Access is recorded and the email is claimed once, not released.
    expect(updates.map((u) => Object.keys(u.payload as object)[0])).toEqual([
      "unlocked_at",
      "download_emailed_at",
    ])
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/reviews")
  })

  it("preserves the token email flow for a single release", async () => {
    arrangeApproval("single")

    await approveSubmissionAction(approvalForm())

    expect(mocks.mintDownloadToken).toHaveBeenCalledWith("submission-1")
    expect(mocks.sendDownloadEmail).toHaveBeenCalledWith({
      creatorId: "creator-1",
      to: "fan@example.test",
      gateTitle: "New Single",
      artist: "Test Artist",
      downloadToken: "single-download-token",
      idempotencyKey: "download-submission-1",
    })
    expect(mocks.sendVaultDownloadEmail).not.toHaveBeenCalled()
  })

  it("does not send or log approval when the conditional update loses a race", async () => {
    const loadQuery = queryReturning(submission("vault"))
    const updateQuery = queryReturning(null)
    mocks.createClient
      .mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "creator-1" } } }),
        },
        from: vi.fn().mockReturnValue(loadQuery),
      })
      .mockResolvedValueOnce({ from: vi.fn().mockReturnValue(updateQuery) })

    await approveSubmissionAction(approvalForm())

    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(mocks.sendVaultDownloadEmail).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
