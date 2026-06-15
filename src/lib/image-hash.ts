import "server-only"

import { createHash } from "node:crypto"

/** SHA-256 of the raw bytes — exact-duplicate detection. */
export function exactHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

/**
 * 64-bit difference hash (dHash) — near-duplicate detection. Resilient to
 * re-encoding/resizing; small Hamming distance means visually similar images.
 *
 * Returns null when sharp's native binary can't load in the runtime, so
 * near-duplicate fraud detection degrades gracefully rather than taking down
 * the whole upload route. Decode failures on genuinely invalid images still
 * throw (callers treat that as "not a valid image").
 */
export async function perceptualHash(buffer: Buffer): Promise<string | null> {
  let sharp
  try {
    sharp = (await import("sharp")).default
  } catch {
    return null
  }

  const { data } = await sharp(buffer)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true })

  let bits = 0n
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits <<= 1n
      if (data[row * 9 + col] > data[row * 9 + col + 1]) {
        bits |= 1n
      }
    }
  }
  return bits.toString(16).padStart(16, "0")
}

export function hammingDistance(hexA: string, hexB: string): number {
  let diff = BigInt(`0x${hexA}`) ^ BigInt(`0x${hexB}`)
  let count = 0
  while (diff > 0n) {
    count += Number(diff & 1n)
    diff >>= 1n
  }
  return count
}
