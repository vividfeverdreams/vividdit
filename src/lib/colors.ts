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
