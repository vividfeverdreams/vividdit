import { describe, expect, it } from "vitest"

import { decideFinalStatus, type VerificationOutcome } from "@/lib/verification"

function outcome(overrides: Partial<VerificationOutcome> = {}): VerificationOutcome {
  return {
    results: [
      { label: "a", confirmed: true, note: "" },
      { label: "b", confirmed: true, note: "" },
    ],
    tampering_suspected: false,
    confidence: 0.95,
    fan_message: "",
    ...overrides,
  }
}

describe("verification decision policy", () => {
  it("auto-approves when all items confirmed, high confidence, no tampering", () => {
    expect(decideFinalStatus(outcome(), 2)).toBe("approved")
  })

  it("routes to review below 0.90 confidence", () => {
    expect(decideFinalStatus(outcome({ confidence: 0.89 }), 2)).toBe(
      "needs_review"
    )
  })

  it("never approves with tampering suspected", () => {
    expect(
      decideFinalStatus(outcome({ tampering_suspected: true }), 2)
    ).toBe("rejected")
  })

  it("routes to review if any item is unconfirmed", () => {
    expect(
      decideFinalStatus(
        outcome({
          results: [
            { label: "a", confirmed: true, note: "" },
            { label: "b", confirmed: false, note: "no" },
          ],
        }),
        2
      )
    ).toBe("needs_review")
  })

  it("rejects when nothing confirmed at high confidence", () => {
    expect(
      decideFinalStatus(
        outcome({
          confidence: 0.92,
          results: [
            { label: "a", confirmed: false, note: "no" },
            { label: "b", confirmed: false, note: "no" },
          ],
        }),
        2
      )
    ).toBe("rejected")
  })

  it("routes to review when the result count doesn't match expected", () => {
    expect(decideFinalStatus(outcome(), 3)).toBe("needs_review")
  })

  it("fails open when the AI couldn't run (no key, no credits, outage)", () => {
    expect(decideFinalStatus(null, 2)).toBe("approved")
  })

  it("routes to review when there was nothing to check", () => {
    expect(decideFinalStatus(outcome({ results: [] }), 0)).toBe("needs_review")
  })
})
