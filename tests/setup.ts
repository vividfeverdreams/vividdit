import { readFileSync } from "node:fs"
import path from "node:path"

// Tests run against the same local stack as `next dev`, so load .env.local
// directly. (@next/env refuses .env.local under NODE_ENV=test by Next
// convention, which is exactly not what we want here.)
const envFile = path.join(process.cwd(), ".env.local")
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
  if (!match) continue
  const [, key, raw] = match
  if (process.env[key] === undefined) {
    process.env[key] = raw.replace(/^"(.*)"$/, "$1")
  }
}
