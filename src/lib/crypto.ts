import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"

// AES-256-GCM for creator API keys at rest. Format: v1:<iv>:<ciphertext>:<tag>
// (all base64). The secret never leaves the server; decryption happens only
// inside the verification pipeline and the "test key" action.

function getSecret(): Buffer {
  const raw = process.env.API_KEY_ENCRYPTION_SECRET
  if (!raw) {
    throw new Error("API_KEY_ENCRYPTION_SECRET is not set")
  }
  const secret = Buffer.from(raw, "base64")
  if (secret.length !== 32) {
    throw new Error("API_KEY_ENCRYPTION_SECRET must be 32 bytes (base64)")
  }
  return secret
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getSecret(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    "v1",
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(":")
}

export function decryptSecret(encoded: string): string {
  const [version, ivB64, ctB64, tagB64] = encoded.split(":")
  if (version !== "v1" || !ivB64 || !ctB64 || !tagB64) {
    throw new Error("Unrecognized ciphertext format")
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSecret(),
    Buffer.from(ivB64, "base64")
  )
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
