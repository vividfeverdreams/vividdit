import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  approveSubmission: vi.fn(),
  emailDownloadOnce: vi.fn(),
  canEmailFans: vi.fn(),
  after: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock("@/lib/unlock", () => ({
  approveSubmission: mocks.approveSubmission,
  completeApproval: vi.fn(),
  emailDownloadOnce: mocks.emailDownloadOnce,
  isStaleReview: vi.fn(() => false),
  markUnlocked: vi.fn(),
}))
vi.mock("@/lib/email-keys", () => ({ canEmailFans: mocks.canEmailFans }))
vi.mock("@/lib/verification", () => ({ runVerification: vi.fn() }))
vi.mock("next/server", () => ({ after: mocks.after }))
vi.mock("next/headers", () => ({ headers: vi.fn() }))

import {
  quickUnlockAction,
  verifiedUnlockAction,
} from "@/app/[artistSlug]/[gateSlug]/actions"

const STATUS_TOKEN = "55555555-5555-4555-8555-555555555555"

// Each table answers the one read the action makes of it.
function admin(
  opts: {
    status?: string
    unlockMode?: string
    flags?: string[]
    freshProofs?: number
  } = {}
) {
  const rows: Record<string, unknown> = {
    submissions: {
      id: "submission-1",
      gate_id: "gate-1",
      status: opts.status ?? "pending",
      email: "fan@example.test",
      status_token: STATUS_TOKEN,
      unlocked_at: null,
      decided_at: "2026-10-27T10:00:00Z",
      fraud_flags: opts.flags ?? [],
      gates: { kind: "single", title: "Song", artist: "Artist", creator_id: "creator-1", status: "published" },
    },
    gate_requirements: {
      unlock_mode: opts.unlockMode ?? "quick",
      require_like: true,
      require_repost: false,
    },
    gate_follow_targets: [{ id: "target-ig" }, { id: "target-sc" }],
    proof_images: [
      { follow_target_id: null },
      { follow_target_id: "target-ig" },
      { follow_target_id: "target-sc" },
    ],
  }
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
  return {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {}
      const result = {
        data: rows[table],
        count: table === "proof_images" ? (opts.freshProofs ?? 0) : null,
        error: null,
      }
      Object.assign(builder, {
        select: vi.fn(() => builder),
        update: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        is: vi.fn(() => builder),
        gt: vi.fn(() => builder),
        maybeSingle: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: unknown) => void) => resolve(result),
      })
      return builder
    }),
    rpc,
  }
}

describe("quick unlock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canEmailFans.mockResolvedValue(true)
    mocks.approveSubmission.mockResolvedValue({
      submission: { id: "submission-1" },
      gate: { kind: "single" },
    })
  })

  it("approves a fan who finished every step and defers the email", async () => {
    mocks.createAdminClient.mockReturnValue(admin())

    const result = await quickUnlockAction({
      statusToken: STATUS_TOKEN,
      completedSteps: ["track", "target-ig", "target-sc"],
    })

    expect(result).toEqual({ ok: true, emailed: true })
    expect(mocks.approveSubmission).toHaveBeenCalledWith(
      expect.anything(),
      "submission-1",
      ["pending"],
      { email: false }
    )
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it("refuses a fan who skipped a step", async () => {
    mocks.createAdminClient.mockReturnValue(admin())

    const result = await quickUnlockAction({
      statusToken: STATUS_TOKEN,
      completedSteps: ["track", "target-ig"],
    })

    expect(result).toEqual({ ok: false, error: "Finish every step to unlock." })
    expect(mocks.approveSubmission).not.toHaveBeenCalled()
  })

  it("won't tap-through unlock a Verified gate", async () => {
    mocks.createAdminClient.mockReturnValue(admin({ unlockMode: "verified" }))

    const result = await quickUnlockAction({
      statusToken: STATUS_TOKEN,
      completedSteps: ["track", "target-ig", "target-sc"],
    })

    expect(result.ok).toBe(false)
    expect(mocks.approveSubmission).not.toHaveBeenCalled()
  })

  it("is a no-op success for a fan who is already approved", async () => {
    mocks.createAdminClient.mockReturnValue(admin({ status: "approved" }))
    mocks.canEmailFans.mockResolvedValue(false)

    const result = await quickUnlockAction({ statusToken: STATUS_TOKEN, completedSteps: [] })

    expect(result).toEqual({ ok: true, emailed: false })
    expect(mocks.approveSubmission).not.toHaveBeenCalled()
  })
})

describe("verified unlock after a rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canEmailFans.mockResolvedValue(true)
  })

  it("refuses the old screenshots", async () => {
    const client = admin({ status: "rejected", unlockMode: "verified", freshProofs: 0 })
    mocks.createAdminClient.mockReturnValue(client)

    const result = await verifiedUnlockAction({ statusToken: STATUS_TOKEN })

    expect(result).toEqual({
      ok: false,
      error: "Add a new screenshot for the steps that didn't pass.",
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("never reopens a revoked fan", async () => {
    const client = admin({
      status: "rejected",
      unlockMode: "verified",
      flags: ["revoked"],
      freshProofs: 3,
    })
    mocks.createAdminClient.mockReturnValue(client)

    const result = await verifiedUnlockAction({ statusToken: STATUS_TOKEN })

    expect(result.ok).toBe(false)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("re-checks fresh screenshots and opens the download meanwhile", async () => {
    const client = admin({ status: "rejected", unlockMode: "verified", freshProofs: 1 })
    mocks.createAdminClient.mockReturnValue(client)

    const result = await verifiedUnlockAction({ statusToken: STATUS_TOKEN })

    expect(result).toEqual({ ok: true, emailed: true })
    expect(client.rpc).toHaveBeenCalledWith("claim_submission_verification", {
      p_submission_id: "submission-1",
      p_status_token: STATUS_TOKEN,
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })
})
