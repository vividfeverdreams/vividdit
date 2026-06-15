import { NextResponse } from "next/server"

// TEMPORARY diagnostic — confirms whether sharp's native binary loads in the
// production serverless runtime. Delete after diagnosing.
export async function GET() {
  try {
    const { default: sharp } = await import("sharp")
    const png = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer()
    return NextResponse.json({
      ok: true,
      sharpVersion: sharp.versions?.sharp ?? null,
      vips: sharp.versions?.vips ?? null,
      pngBytes: png.length,
      platform: process.platform,
      arch: process.arch,
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      name: e instanceof Error ? e.name : "unknown",
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 6) : null,
      platform: process.platform,
      arch: process.arch,
    })
  }
}
