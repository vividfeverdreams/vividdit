// Client-safe color helpers.

export function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

/** Black or white text, whichever is readable on the given background. */
export function readableForeground(hexBg: string): string {
  if (!isHex(hexBg)) return "#ffffff"
  const r = parseInt(hexBg.slice(1, 3), 16) / 255
  const g = parseInt(hexBg.slice(3, 5), 16) / 255
  const b = parseInt(hexBg.slice(5, 7), 16) / 255
  // Relative luminance (sRGB).
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.45 ? "#0a0a0a" : "#ffffff"
}

/** A subtle translucent version of a color (for muted text on a themed bg). */
export function muted(hexFg: string, alpha = 0.7): string {
  const r = parseInt(hexFg.slice(1, 3), 16)
  const g = parseInt(hexFg.slice(3, 5), 16)
  const b = parseInt(hexFg.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

type Rgb = { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

function relLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rp = 0
  let gp = 0
  let bp = 0
  if (h < 60) [rp, gp, bp] = [c, x, 0]
  else if (h < 120) [rp, gp, bp] = [x, c, 0]
  else if (h < 180) [rp, gp, bp] = [0, c, x]
  else if (h < 240) [rp, gp, bp] = [0, x, c]
  else if (h < 300) [rp, gp, bp] = [x, 0, c]
  else [rp, gp, bp] = [c, 0, x]
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 }
}

/**
 * Returns an accent color guaranteed to be legible on the given background.
 * Keeps the accent's hue/saturation but shifts its lightness (toward white on a
 * dark bg, toward black on a light bg) until it meets a minimum contrast ratio.
 * Used so accent-colored text (e.g. the "Free download" label) is never an
 * unreadable dark-on-dark combination.
 */
export function readableAccent(
  accentHex: string,
  bgHex: string,
  minRatio = 3
): string {
  if (!isHex(accentHex) || !isHex(bgHex)) return accentHex
  const bg = hexToRgb(bgHex)
  const accent = hexToRgb(accentHex)
  if (contrastRatio(accent, bg) >= minRatio) return accentHex

  const goLighter = relLuminance(bg) < 0.5
  const { h, s } = rgbToHsl(accent)
  let { l } = rgbToHsl(accent)
  // Boost saturation a touch so the lightened color still reads as a color.
  const sat = Math.max(s, 0.5)
  for (let i = 0; i < 20; i++) {
    l = goLighter ? Math.min(1, l + 0.05) : Math.max(0, l - 0.05)
    const cand = hslToRgb(h, sat, l)
    if (contrastRatio(cand, bg) >= minRatio) return rgbToHex(cand)
  }
  return goLighter ? "#ffffff" : "#0a0a0a"
}
