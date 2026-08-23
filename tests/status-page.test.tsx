import { isValidElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found")
  }),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}))

import StatusPage from "@/app/s/[token]/page"

const STATUS_TOKEN = "11111111-1111-4111-8111-111111111111"

function approvedSubmission(kind: "single" | "vault") {
  return {
    id: "submission-1",
    status: "approved",
    proof_code: null,
    email: null,
    created_at: "2026-08-23T00:00:00.000Z",
    gates: {
      title: kind === "vault" ? "The Complete Vault" : "New Single",
      artist: "Test Artist",
      kind,
      gate_requirements: null,
    },
  }
}

function adminReturning(submission: ReturnType<typeof approvedSubmission>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: submission }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return { from: vi.fn().mockReturnValue(query) }
}

function findAnchorHref(node: ReactNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const href = findAnchorHref(child)
      if (href) return href
    }
    return null
  }
  if (!isValidElement(node)) return null
  const props = node.props as Record<string, unknown>
  if (node.type === "a" && typeof props.href === "string") return props.href
  for (const value of Object.values(props)) {
    const href = findAnchorHref(value as ReactNode)
    if (href) return href
  }
  return null
}

describe("approved submission status routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("opens the multi-file vault page for an approved vault", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminReturning(approvedSubmission("vault"))
    )

    const page = await StatusPage({
      params: Promise.resolve({ token: STATUS_TOKEN }),
    })

    expect(findAnchorHref(page)).toBe(`/download/vault/${STATUS_TOKEN}`)
  })

  it("keeps approved single releases on the single-file route", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminReturning(approvedSubmission("single"))
    )

    const page = await StatusPage({
      params: Promise.resolve({ token: STATUS_TOKEN }),
    })

    expect(findAnchorHref(page)).toBe(`/download/by-status/${STATUS_TOKEN}`)
  })
})
