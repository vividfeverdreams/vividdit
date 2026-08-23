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

function arrangeApproval(kind: "single" | "vault") {
  const loadQuery = queryReturning(submission(kind))
  const updateQuery = queryReturning({ id: "submission-1" })
  const loadClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "creator-1" } } }) },
    from: vi.fn().mockReturnValue(loadQuery),
  }
  const updateClient = { from: vi.fn().mockReturnValue(updateQuery) }
  const insertEvent = vi.fn().mockResolvedValue({ error: null })
  const admin = {
    from: vi.fn().mockReturnValue({ insert: insertEvent }),
  }

  mocks.createClient
    .mockResolvedValueOnce(loadClient)
    .mockResolvedValueOnce(updateClient)
  mocks.createAdminClient.mockReturnValue(admin)
  return { insertEvent, updateQuery }
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
    mocks.sendDownloadEmail.mockResolvedValue(undefined)
    mocks.sendVaultDownloadEmail.mockResolvedValue(undefined)
  })

  it("emails the durable vault page and does not mint a single-file token", async () => {
    const { insertEvent } = arrangeApproval("vault")

    await approveSubmissionAction(approvalForm())

    expect(mocks.sendVaultDownloadEmail).toHaveBeenCalledWith({
      creatorId: "creator-1",
      to: "fan@example.test",
      gateTitle: "The Complete Vault",
      artist: "Test Artist",
      statusToken: STATUS_TOKEN,
    })
    expect(mocks.mintDownloadToken).not.toHaveBeenCalled()
    expect(mocks.sendDownloadEmail).not.toHaveBeenCalled()
    expect(insertEvent).toHaveBeenCalledWith({
      gate_id: "gate-1",
      submission_id: "submission-1",
      event_type: "approve",
    })
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
