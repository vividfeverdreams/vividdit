import { describe, expect, it } from "vitest"

import { decryptSecret, encryptSecret } from "@/lib/crypto"

describe("BYOK key encryption", () => {
  it("round-trips a key", () => {
    const key = "sk-proj-abc123XYZ_secret-key-material"
    const encrypted = encryptSecret(key)
    expect(encrypted).not.toContain(key)
    expect(encrypted.startsWith("v1:")).toBe(true)
    expect(decryptSecret(encrypted)).toBe(key)
  })

  it("produces a different ciphertext every call (random IV)", () => {
    const key = "sk-same-key"
    expect(encryptSecret(key)).not.toBe(encryptSecret(key))
  })

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const encrypted = encryptSecret("sk-tamper-test")
    const [v, iv, ct, tag] = encrypted.split(":")
    const ctBytes = Buffer.from(ct, "base64")
    ctBytes[0] ^= 0xff
    const tampered = [v, iv, ctBytes.toString("base64"), tag].join(":")
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it("rejects unknown formats", () => {
    expect(() => decryptSecret("v2:a:b:c")).toThrow()
    expect(() => decryptSecret("garbage")).toThrow()
  })
})
