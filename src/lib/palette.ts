import "server-only"

// Suggests a page background + accent color from cover art. background = a
// deep, darkened version of the dominant color (moody, readable with light
// text); accent = the most vibrant pixel (good for buttons).

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const s = max === 0 ? 0 : d / max
  return { s, v: max }
}

export type Palette = { background: string; accent: string }

export async function extractPalette(imageUrl: string): Promise<Palette | null> {
  try {
    // Import lazily inside the try: if sharp's native binary fails to load in
    // the serverless bundle, we degrade to "no auto colors" instead of a 500.
    const { default: sharp } = await import("sharp")

    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())

    const { dominant } = await sharp(buf).stats()
    // Darken the dominant color for a deep page background.
    const background = toHex(
      dominant.r * 0.3,
      dominant.g * 0.3,
      dominant.b * 0.3
    )

    // Sample a small grid and pick the most vibrant pixel for the accent.
    const w = 24
    const h = 24
    const raw = await sharp(buf)
      .resize(w, h, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer()

    let best = { score: -1, r: dominant.r, g: dominant.g, b: dominant.b }
    for (let i = 0; i < raw.length; i += 3) {
      const r = raw[i]
      const g = raw[i + 1]
      const b = raw[i + 2]
      const { s, v } = rgbToHsv(r, g, b)
      // Favor saturated, reasonably bright colors.
      const score = s * (v > 0.35 && v < 0.97 ? v : 0)
      if (score > best.score) best = { score, r, g, b }
    }

    return { background, accent: toHex(best.r, best.g, best.b) }
  } catch {
    return null
  }
}
