import type { NextConfig } from "next";

// Content-Security-Policy. Allowlists the third parties the app actually uses:
// the SoundCloud player iframe (frame-src), opt-in ad pixels (script/frame),
// and cover/artwork images (img-src). connect-src stays broad (https:/wss:) so
// Supabase, presigned R2 uploads, and pixel beacons keep working — the
// meaningful hardening here is frame-ancestors (anti-clickjacking), object-src
// 'none', and base-uri 'self'. (Inline scripts/styles are allowed because Next
// emits inline bootstrap; nonce-based CSP is a future hardening step.)
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net https://www.googletagmanager.com https://www.google-analytics.com https://analytics.tiktok.com https://*.tiktok.com",
  "frame-src 'self' https://w.soundcloud.com https://www.facebook.com https://td.doubleclick.net https://bid.g.doubleclick.net https://www.googletagmanager.com",
  "connect-src 'self' https: wss:",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
  experimental: {
    // The creator access gate (/get-access) uploads follow-proof screenshots
    // through a Server Action, which defaults to a 1MB body cap — a single
    // phone screenshot easily exceeds that and 500s. Raise it to cover the
    // action's own limit (up to 3 images × 10MB) so its friendly per-file
    // validation governs instead. (Fan gates upload via an API route, which
    // has no such cap.)
    serverActions: {
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
