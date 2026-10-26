import "server-only"

import { createHash } from "node:crypto"

/** Salted hash of the caller's IP: enough to rate-limit, never the IP itself. */
export function hashRequestIp(headers: Headers): string | null {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip")
  const secret = process.env.API_KEY_ENCRYPTION_SECRET ?? "vividdit"
  return ip ? createHash("sha256").update(`${secret}:${ip}`).digest("hex") : null
}
