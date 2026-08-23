import { describe, expect, it } from "vitest"

import {
  MAX_PROOF_BYTES,
  MAX_PROOF_TOTAL_BYTES,
  proofBatchError,
  proofFileError,
} from "@/lib/proof-upload-contract"

describe("proof upload contract", () => {
  it("accepts the incident batch while keeping it out of Vercel Functions", () => {
    const files = [
      { name: "a.png", type: "image/png", size: 1_429_882 },
      { name: "b.png", type: "image/png", size: 2_774_250 },
      { name: "c.png", type: "image/png", size: 2_820_474 },
    ]
    expect(files.reduce((total, file) => total + file.size, 0)).toBeGreaterThan(
      4_500_000
    )
    expect(proofBatchError(files)).toBeNull()
  })

  it("caps aggregate image bytes before verification builds an AI payload", () => {
    expect(
      proofBatchError([
        { name: "a.png", type: "image/png", size: 9 * 1024 * 1024 },
        { name: "b.png", type: "image/png", size: 9 * 1024 * 1024 },
        { name: "c.png", type: "image/png", size: 9 * 1024 * 1024 },
      ])
    ).toBe("Screenshots must be 25MB or less in total.")
    expect(MAX_PROOF_TOTAL_BYTES).toBe(25 * 1024 * 1024)
  })

  it("rejects unsupported, empty, and over-10MB files with friendly errors", () => {
    expect(
      proofFileError({ name: "proof.gif", type: "image/gif", size: 100 })
    ).toBe("Screenshots must be JPG, PNG, or WEBP.")
    expect(
      proofFileError({ name: "empty.png", type: "image/png", size: 0 })
    ).toContain("doesn't look like a valid image")
    expect(
      proofFileError({
        name: "huge.png",
        type: "image/png",
        size: MAX_PROOF_BYTES + 1,
      })
    ).toBe("huge.png is over 10MB.")
  })

  it("does not treat Object prototype keys as supported MIME types", () => {
    expect(
      proofFileError({ name: "proof.png", type: "toString", size: 100 })
    ).toBe("Screenshots must be JPG, PNG, or WEBP.")
  })
})
