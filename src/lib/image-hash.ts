import "server-only"

import { createHash } from "node:crypto"
import sharp from "sharp"

/** SHA-256 of the raw bytes — exact-duplicate detection. */
export function exactHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

/**
 * 64-bit difference hash (dHash) — near-duplicate detection. Resilient to
 * re-encoding/resizing; small Hamming distance means visually similar images.
 * Also serves as image validation: sharp throws on non-image bytes.
 */
export async function perceptualHash(buffer: Buffer): Promise<string> {
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
