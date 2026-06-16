import { readableAccent } from "@/lib/colors"

// Browser-side cover-art palette extraction via <canvas>. Runs in the client
// (no server, no sharp — which can't load native libvips in the serverless
// runtime). SoundCloud's CDN and Supabase storage both send
// `access-control-allow-origin: *`, so the canvas isn't tainted and pixels are
// readable. Returns null on any failure (CORS taint, load error) so callers
// keep their current colors.

export type Palette = { background: string; accent: string }

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const d = max - min
  return { s: max === 0 ? 0 : d / max, v: max }
}

export async function extractPaletteFromImage(
  url: string
): Promise<Palette | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const size = 48
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)

        let rSum = 0
        let gSum = 0
        let bSum = 0
        let count = 0
        let best = { score: -1, r: 0, g: 0, b: 0 }
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (data[i + 3] < 128) continue
          rSum += r
          gSum += g
          bSum += b
          count++
          const { s, v } = rgbToHsv(r, g, b)
          // Favor saturated, mid-bright pixels for a punchy accent.
          const score = s * (v > 0.35 && v < 0.97 ? v : 0)
          if (score > best.score) best = { score, r, g, b }
        }
        if (!count) return resolve(null)

        // Background: a deep, darkened version of the average color (readable
        // with light text).
        const background = rgbToHex(
          (rSum / count) * 0.3,
          (gSum / count) * 0.3,
          (bSum / count) * 0.3
        )
        // Accent: the most vibrant pixel, guaranteed legible on the background.
        const rawAccent =
          best.score > 0
            ? rgbToHex(best.r, best.g, best.b)
            : rgbToHex(rSum / count, gSum / count, bSum / count)
        resolve({ background, accent: readableAccent(rawAccent, background) })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
