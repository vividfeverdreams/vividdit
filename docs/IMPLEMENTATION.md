# Vividdit — Implementation Plan

MVP per [PLAN.md](./PLAN.md), with these confirmed decisions:

- **Dev backend:** local Supabase via CLI (Docker). Hosted Supabase + Vercel at deploy time.
- **Link delivery:** auto-approved fans download directly on the page; manual-review approvals email the fan a download link via Resend.
- **Creator auth:** email + password with email verification (Supabase Auth; local Mailpit captures verification emails in dev).

## Stack & key technical decisions

| Concern | Decision |
|---|---|
| Framework | Next.js (App Router, TypeScript), Tailwind CSS + shadcn/ui |
| Auth/DB/Storage | Supabase via `@supabase/ssr` (browser client, server client, service-role admin client) |
| BYOK key encryption | AES-256-GCM with a server-only `API_KEY_ENCRYPTION_SECRET` (32-byte env var). Encrypt/decrypt only in server code. UI shows masked key + status only — ciphertext never selected by client-readable queries. |
| AI verification | OpenAI Responses API, image inputs + Structured Outputs (strict JSON schema). Default model `gpt-5.4-mini`, overridable in advanced settings. |
| Signed downloads | Private bucket + short-lived signed URLs for on-page delivery. Email links go to a **redemption route** (`/download/[token]`) backed by a `download_tokens` table (expiry + use limit) that mints a fresh signed URL — no raw storage URLs in emails. |
| HQ file upload | Supabase resumable (TUS) upload — WAV/AIFF/ZIP files are routinely >100MB; bucket size limit set accordingly. |
| Image hashing | `sharp` for normalization; SHA-256 exact hash + dHash perceptual hash computed server-side on proof upload. |
| Proof cleanup (30 days) | `pg_cron` locally; Vercel Cron route in production. Skips proofs tied to unresolved reviews. |
| SoundCloud embed | oEmbed endpoint to resolve track metadata/artwork at gate creation; official widget iframe on the fan page. No widget-based action verification (playback events only, per plan). |
| Email | Resend for fan-facing email (review outcome + download link, resubmission requests). Supabase Auth handles creator verification emails. Dev mode logs/captures email instead of sending if no Resend key. |

## Storage buckets

- `covers` — public read, creator write (own folder)
- `hq-files` — private; creator write; downloads only via signed URL
- `proofs` — private; anonymous upload via server endpoint only; creator read (own gates)

## Database migrations (in order)

1. **`profiles`** — FK to `auth.users`, artist_name, artist_slug (unique, immutable once set), soundcloud_profile_url, branding jsonb. Trigger creates row on signup.
2. **`creator_ai_keys`** — creator_id, provider (`openai`), encrypted_key, key_status (`untested|valid|invalid`), last_tested_at, last_error.
3. **`gates`** + **`gate_requirements`** — gates: creator_id, title, artist, soundcloud_url, slug (immutable after publish), status (`draft|published|archived`), theme jsonb, cover_path. requirements: email_enabled, soundcloud_enabled, require_like/repost/follow.
4. **`download_assets`** — gate_id, storage_path, filename, size, mime_type.
5. **`submissions`** + **`proof_images`** — submissions: gate_id, email, email_purpose (`fan_list|review_status`), proof_code (`GATE-XXXX`), status (`pending|verifying|approved|rejected|needs_review`), ip_hash, user_agent, fraud_flags jsonb, timestamps. proof_images: submission_id, storage_path, exact_hash, perceptual_hash.
6. **`verification_runs`** — submission_id, provider, model, criteria jsonb, result jsonb, decision, confidence, token usage (input/output), error.
7. **`events`** — gate_id, submission_id, event_type (`view|submit|approve|reject|download`), utm_source/medium/campaign, referrer, source.
8. **`download_tokens`** — submission_id, token_hash, expires_at, max_uses, use_count. *(Added for email delivery.)*

**RLS:** creators access only rows reachable from their `auth.uid()` (gates → requirements/assets/submissions/proofs/runs/events). Fan-facing reads/writes (published gate lookup, submission insert, status check) go through server routes using scoped queries — anon role gets minimal direct table access. Storage policies mirror this.

## Build phases

### Phase 0 — Scaffold & infrastructure
`create-next-app`, Tailwind + shadcn/ui, `supabase init` + local stack, env wiring (`.env.local`, `.env.example`), the three Supabase clients, base layout/branding shell.

### Phase 1 — Schema & RLS
All migrations above, storage buckets + policies, seed script (test creator, draft gate). Verify RLS with a cross-creator access test.

### Phase 2 — Creator auth & onboarding
Signup/login/logout, email verification flow (Mailpit in dev), middleware guarding `/dashboard`, profile completion (artist name, SoundCloud profile URL, artist slug).

### Phase 3 — Settings & BYOK keys
Encrypted key save, **Test key** action (lightweight OpenAI call), key status + last error display, key removal, advanced model override. Publish guard logic: email-only gates publish without a key; SoundCloud gates require `key_status = valid`.

### Phase 4 — Gate builder wizard
Steps: SoundCloud URL (validate + oEmbed metadata prefill) → HQ file upload (TUS) → artist/title → design (cover, theme) → gate toggles (email / like / repost / follow) → slug (availability check, immutability warning) → confirm & publish. Plus the Download Gates list page (status, copy public URL, archive).

### Phase 5 — Public fan gate page
`/[artistSlug]/[gateSlug]` SSR page: SoundCloud widget, metadata, unlock panel shown immediately. Submission flow: email step (consent copy; status-only email collection when Email Gate is off but review may occur) → proof code issued (`GATE-XXXX`) → toggle-adaptive screenshot instructions → upload (JPG/PNG/WEBP, ≤5 files, ≤10MB each, validated client and server side). Status page at a tokenized URL so fans can check back. UTM/referrer captured into `events` on page view.

### Phase 6 — AI verification pipeline
Server-only endpoint: decrypt creator key → send proof images to OpenAI Responses API with the strict result schema from PLAN.md → persist `verification_runs`. Decision policy: auto-approve at confidence ≥ 0.90 with all enabled requirements confirmed and no tampering; auto-reject only obvious failures; everything else → `needs_review`. Pre-checks before spending tokens: exact-hash duplicate block, perceptual-hash near-duplicate flag, repeated IP/email flags.

### Phase 7 — Download delivery
On approval: mint download token; auto-approve path shows the download button on-page (short-TTL signed URL); manual-review approvals send the Resend email linking to `/download/[token]`. Redemption route validates expiry/uses and 302s to a fresh signed URL.

### Phase 8 — Manual review dashboard
Reviews queue: proof screenshots, AI result + confidence, missing requirements, approve/reject with optional message. Approve → token + email. Reject → email asking for clearer proof; fan can resubmit against the same submission (new proof code optional).

### Phase 9 — Fans & analytics
Fans page: fan-list emails with consent timestamps, CSV export (**excludes** `review_status` emails). Analytics per gate: views, submissions, approval rate, downloads, top sources/UTMs; CSV export of events.

### Phase 10 — Hardening & jobs
30-day proof deletion job, rate limiting on submission/verification endpoints, security pass (creator key never serialized client-side, RLS coverage, signed URL TTLs), duplicate/fraud flag surfacing in review UI.

### Phase 11 — Test plan & deploy prep
Map PLAN.md's test plan to: unit tests (decision policy, hashing, token redemption, encryption round-trip), RLS integration tests, and an end-to-end manual checklist (email-only gate, SoundCloud-only, combined, duplicate screenshot, expired link). Deploy steps documented: hosted Supabase (migrations push), Vercel env vars, Resend domain + key, production cron.

## Needed from you (only at later phases)

- **Phase 6 testing:** an OpenAI API key to exercise real verification (any key works — it plays the "creator's BYOK key" role in dev).
- **Phase 7/11:** Resend API key (free tier) when you want real email sending; dev captures email locally until then.
- **Deploy time:** hosted Supabase project + Vercel project.

## Out of scope (deferred per PLAN.md)

Billing, tracking pixels, custom domains, Spotify gates, platform discovery, non-OpenAI providers.
