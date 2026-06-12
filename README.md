# Vividdit

Free download gates for SoundCloud artists. Fans unlock an HQ file (WAV/AIFF/ZIP)
by joining your email list and/or proving like · repost · follow with a single
screenshot — verified by AI using **your own OpenAI key** (BYOK). No SoundCloud
API, no browser automation: the track stays public, the download is the reward.

## How it works

1. **Creator** publishes a gate: SoundCloud track + private HQ file + unlock
   requirements + immutable URL (`/artist/track-slug`).
2. **Fan** lands on the gate from the track's buy-link, does the actions on the
   SoundCloud track page, pastes a one-time proof code into the comment box,
   and uploads one screenshot.
3. **AI verification** (OpenAI Responses API, structured outputs) approves,
   rejects with a fix-it message, or routes to the creator's review queue.
   Server-side policy has the final say; fraud signals veto auto-approval.
4. **Delivery**: approved fans download via short-lived signed URLs — on the
   page instantly, or via a tokenized email link after manual review.

## Stack

Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase
(Auth/Postgres/Storage, full RLS) · Resend · Vercel.

## Development

Prereqs: Node 20+, pnpm, Docker (OrbStack/Docker Desktop).

```sh
pnpm install
pnpm exec supabase start    # local stack; prints keys
cp .env.example .env.local  # fill in values from `supabase status`
pnpm dev
```

Useful local URLs: Studio `http://127.0.0.1:54323`, Mailpit (auth emails)
`http://127.0.0.1:54324`.

## Tests

```sh
pnpm test    # unit + integration (integration self-skips without the local stack)
```

Coverage map: [docs/TEST-PLAN.md](docs/TEST-PLAN.md).

## Deploying

Runbook: [docs/DEPLOY.md](docs/DEPLOY.md) — hosted Supabase, Vercel, Resend,
cron, and the post-deploy checklist.

## Docs

- [docs/PLAN.md](docs/PLAN.md) — original product/MVP plan
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — phased build plan
