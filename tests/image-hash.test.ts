import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { exactHash, hammingDistance, perceptualHash } from "@/lib/image-hash"

async function makeImage(opts: {
  width?: number
  text?: boolean
  base: { r: number; g: number; b: number }
}): Promise<Buffer> {
  const width = opts.width ?? 400
  // Gradient-ish composition so the dHash has structure to latch onto.
  const overlay = await sharp({
    create: {
      width: Math.round(width / 2),
      height: 150,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.9 },
    },
  })
    .png()
    .toBuffer()
  return sharp({
    create: {
      width,
      height: 300,
      channels: 3,
      background: opts.base,
    },
  })
    .composite([{ input: overlay, top: 20, left: 10 }])
    .png()
    .toBuffer()
}

describe("image hashing", () => {
  it("exactHash is deterministic and collision-sensitive", async () => {
    const a = await makeImage({ base: { r: 20, g: 20, b: 20 } })
    const b = await makeImage({ base: { r: 20, g: 20, b: 21 } })
    expect(exactHash(a)).toBe(exactHash(a))
    expect(exactHash(a)).not.toBe(exactHash(b))
  })

  it("perceptualHash survives re-encoding and resizing", async () => {
    const original = await makeImage({ base: { r: 30, g: 60, b: 120 } })
    const resized = await sharp(original).resize(250).jpeg({ quality: 80 }).toBuffer()

    const h1 = await perceptualHash(original)
    const h2 = await perceptualHash(resized)
    expect(exactHash(original)).not.toBe(exactHash(resized))
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(8)
  })

  it("perceptualHash separates genuinely different images", async () => {
    const a = await perceptualHash(
      await makeImage({ base: { r: 30, g: 60, b: 120 } })
    )
    const dark = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 5, g: 5, b: 5 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 80,
              height: 280,
              channels: 4,
              background: { r: 250, g: 100, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          top: 10,
          left: 300,
        },
      ])
      .png()
      .toBuffer()
    const b = await perceptualHash(dark)
    expect(hammingDistance(a, b)).toBeGreaterThan(8)
  })

  it("rejects non-image bytes", async () => {
    await expect(perceptualHash(Buffer.from("not an image"))).rejects.toThrow()
  })
})
