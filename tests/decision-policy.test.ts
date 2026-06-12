import { describe, expect, it } from "vitest"

import { decideFinalStatus, type VerificationOutcome } from "@/lib/verification"

const REQUIRED = { like: true, repost: false, follow: true }

function outcome(overrides: Partial<VerificationOutcome> = {}): VerificationOutcome {
  return {
    decision: "approve",
    confidence: 0.95,
    track_match: true,
    artist_match: true,
    like_confirmed: true,
    repost_confirmed: false,
    follow_confirmed: true,
    proof_code_visible: true,
    tampering_suspected: false,
    missing_requirements: [],
    fan_message: "",
    ...overrides,
  }
}

describe("verification decision policy", () => {
  it("auto-approves strong, complete proof", () => {
    expect(decideFinalStatus(outcome(), REQUIRED, [])).toBe("approved")
  })

  it("routes to review below the 0.90 confidence bar", () => {
    expect(
      decideFinalStatus(outcome({ confidence: 0.89 }), REQUIRED, [])
    ).toBe("needs_review")
  })

  it("never auto-approves when tampering is suspected", () => {
    expect(
      decideFinalStatus(outcome({ tampering_suspected: true }), REQUIRED, [])
    ).toBe("needs_review")
  })

  it("never auto-approves with an enabled requirement unconfirmed", () => {
    expect(
      decideFinalStatus(outcome({ follow_confirmed: false }), REQUIRED, [])
    ).toBe("needs_review")
  })

  it("ignores requirements that are not enabled", () => {
    // repost not required — repost_confirmed=false must not block approval.
    expect(
      decideFinalStatus(outcome({ repost_confirmed: false }), REQUIRED, [])
    ).toBe("approved")
  })

  it("auto-rejects confident, obvious failures", () => {
    expect(
      decideFinalStatus(
        outcome({ decision: "reject", confidence: 0.95 }),
        REQUIRED,
        []
      )
    ).toBe("rejected")
  })

  it("routes low-confidence rejects to review", () => {
    expect(
      decideFinalStatus(
        outcome({ decision: "reject", confidence: 0.7 }),
        REQUIRED,
        []
      )
    ).toBe("needs_review")
  })

  it("routes the model's own 'review' decision to review", () => {
    expect(
      decideFinalStatus(
        outcome({ decision: "review", confidence: 0.99 }),
        REQUIRED,
        []
      )
    ).toBe("needs_review")
  })

  it("fraud flags veto auto-approval", () => {
    expect(decideFinalStatus(outcome(), REQUIRED, ["repeat_ip"])).toBe(
      "needs_review"
    )
  })

  it("fraud flags do not soften a confident reject", () => {
    expect(
      decideFinalStatus(
        outcome({ decision: "reject", confidence: 0.9 }),
        REQUIRED,
        ["repeat_ip"]
      )
    ).toBe("rejected")
  })

  it("missing outcome (API error) routes to review", () => {
    expect(decideFinalStatus(null, REQUIRED, [])).toBe("needs_review")
  })
})
