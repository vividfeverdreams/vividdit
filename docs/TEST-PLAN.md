# Test Plan Coverage

Maps the MVP test plan from [PLAN.md](./PLAN.md) to its coverage. "Live E2E" =
performed in a real browser against the local stack during development;
automated tests run with `pnpm test` (integration suites need `supabase start`).

| Plan item | Coverage |
|---|---|
| Creator signs up, saves/tests OpenAI key, creates gate, uploads HQ file, publishes slug, copies URL | Live E2E (Phases 2–4): signup → Mailpit confirmation → onboarding → key save + live test → wizard publish with real SoundCloud track + TUS upload |
| Email-only gate publishes and unlocks without an OpenAI key | Publish guard allows email-only without key (code path); instant-approve path live-tested via auto-approval logic |
| SoundCloud gate cannot publish until creator has a valid key | Live E2E (Phase 4) — guard in `createGateAction` + quick-publish action |
| Like/repost/follow toggles update fan instructions and AI criteria | Live E2E (Phases 5–6): instructions adapt to toggles; criteria JSON recorded per verification run |
| Fan completes email-only / SoundCloud-only / email+SoundCloud gates | Email+SoundCloud live E2E (Phases 5–8); email-only auto-approve path unit-level (instant approve in `startSubmissionAction`) |
| AI auto-approves strong proof, rejects clear failures, routes ambiguity to review | `tests/decision-policy.test.ts` (11 cases, full matrix incl. fraud veto); live run produced a real `review` verdict with tampering flag |
| Creator can approve/reject review submissions | Live E2E (Phase 8): reject → email + resubmit → re-verify → approve → download email |
| Signed download links expire; private files not directly accessible | `tests/downloads.integration.test.ts`: expiry, max-uses, garbage tokens, status-token gating, direct-access block |
| Duplicate screenshots blocked or flagged | Live E2E (Phase 5): exact-duplicate re-upload → 409. Near-duplicate flagging via perceptual hash (`tests/image-hash.test.ts` validates hash behavior) |
| CSV export excludes status-only review emails | Live E2E (Phase 9): planted `review_status` row absent from page + CSV |
| RLS prevents cross-creator access | `tests/rls.integration.test.ts` (9 cases): drafts hidden, updates/inserts blocked, ai_keys + download_tokens service-role-only, slug immutability, submission isolation |
| Encryption at rest for creator keys | `tests/crypto.test.ts`: round-trip, random IV, GCM tamper rejection; live DB inspection showed `v1:` ciphertext only |

## Running

```sh
pnpm test          # all suites; integration files self-skip if the local stack is down
pnpm test:watch
```
