import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  complete: vi.fn(),
  discard: vi.fn(),
  reconcile: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
}))

vi.mock("@/app/proof-upload-actions", () => ({
  prepareProofUploadsAction: mocks.prepare,
  completeProofUploadsAction: mocks.complete,
  discardProofUploadsAction: mocks.discard,
  reconcileProofUploadBatchAction: mocks.reconcile,
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: mocks.from },
  }),
}))

import {
  ProofUploadClientError,
  uploadProofFiles,
} from "@/lib/proof-upload-client"

const submissionId = "11111111-1111-4111-8111-111111111111"
const statusToken = "22222222-2222-4222-8222-222222222222"
const batchId = "33333333-3333-4333-8333-333333333333"

function screenshot(name: string, size: number) {
  return new File([new Uint8Array(size)], name, { type: "image/png" })
}

describe("direct proof uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ uploadToSignedUrl: mocks.upload })
    mocks.upload.mockResolvedValue({
      data: { path: "ok", fullPath: "proofs/ok" },
      error: null,
    })
    mocks.prepare.mockImplementation(async ({ files }: { files: unknown[] }) => ({
      ok: true,
      batchId,
      expiresAt: "2026-08-23T20:00:00.000Z",
      targets: files.map((_, index) => ({
        path: `gate/submission/uploads/${batchId}/${index}.png`,
        token: `signed-${index}`,
      })),
    }))
    mocks.complete.mockResolvedValue({ ok: true, count: 3 })
    mocks.discard.mockResolvedValue({ ok: true })
    mocks.reconcile.mockResolvedValue({ completed: false, count: 0 })
  })

  it("keeps a multi-file payload larger than Vercel's limit out of server actions", async () => {
    const files = [
      screenshot("instagram.png", 1_429_882),
      screenshot("soundcloud.png", 2_774_250),
      screenshot("spotify.png", 2_820_474),
    ]
    expect(files.reduce((total, file) => total + file.size, 0)).toBeGreaterThan(
      4_500_000
    )

    await expect(
      uploadProofFiles({ submissionId, statusToken, files })
    ).resolves.toBe(3)

    const prepareInput = mocks.prepare.mock.calls[0][0]
    expect(prepareInput.files).toEqual(
      files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      }))
    )
    expect(prepareInput.files.every((file: unknown) => !(file instanceof File))).toBe(
      true
    )
    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledWith("proofs")
    expect(mocks.upload).toHaveBeenCalledTimes(3)
    expect(mocks.complete).toHaveBeenCalledWith({
      submissionId,
      statusToken,
      batchId,
      uploads: files.map((file, index) => ({
        path: `gate/submission/uploads/${batchId}/${index}.png`,
        name: file.name,
      })),
    })
    expect(mocks.discard).not.toHaveBeenCalled()
  })

  it("cleans every staged path after a direct storage failure", async () => {
    const files = [screenshot("one.png", 100), screenshot("two.png", 100)]
    mocks.upload
      .mockResolvedValueOnce({ data: { path: "one" }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("storage unavailable") })

    await expect(
      uploadProofFiles({ submissionId, statusToken, files })
    ).rejects.toThrow("Couldn't upload two.png")

    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.discard).toHaveBeenCalledWith({
      submissionId,
      statusToken,
      batchId,
    })
  })

  it("surfaces server validation errors and requests defensive cleanup", async () => {
    const files = [screenshot("duplicate.png", 100)]
    mocks.complete.mockResolvedValue({
      ok: false,
      error: "That screenshot was already used for this gate.",
    })

    await expect(
      uploadProofFiles({ submissionId, statusToken, files })
    ).rejects.toEqual(
      new ProofUploadClientError("That screenshot was already used for this gate.")
    )
    expect(mocks.discard).toHaveBeenCalledWith({
      submissionId,
      statusToken,
      batchId,
    })
  })

  it("reconciles a committed batch when the completion response is lost", async () => {
    const files = [screenshot("committed.png", 100)]
    mocks.complete.mockRejectedValue(new TypeError("Failed to fetch"))
    mocks.reconcile.mockResolvedValue({ completed: true, count: 1 })

    await expect(
      uploadProofFiles({ submissionId, statusToken, files })
    ).resolves.toBe(1)

    expect(mocks.reconcile).toHaveBeenCalledWith({
      submissionId,
      statusToken,
      batchId,
    })
    expect(mocks.discard).not.toHaveBeenCalled()
  })

  it("reconciles a committed batch after an ambiguous error result", async () => {
    const files = [screenshot("committed-result.png", 100)]
    mocks.complete.mockResolvedValue({
      ok: false,
      error: "Couldn't process the screenshots. Try again.",
    })
    mocks.reconcile.mockResolvedValue({ completed: true, count: 1 })

    await expect(
      uploadProofFiles({ submissionId, statusToken, files })
    ).resolves.toBe(1)

    expect(mocks.reconcile).toHaveBeenCalledWith({
      submissionId,
      statusToken,
      batchId,
    })
    expect(mocks.discard).not.toHaveBeenCalled()
  })
})
