# Vividdit — Production Deploy Runbook

Stack: hosted Supabase (Auth/Postgres/Storage) + Vercel (Next.js) + Resend (fan email).

## 1. Hosted Supabase project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) (pick a strong DB password, region near your fans).
2. Link and push the schema from the repo:
   ```sh
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <PROJECT_REF>
   pnpm exec supabase db push          # applies every migration, incl. buckets + RLS
   ```
3. Dashboard → **Authentication → URL Configuration**:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/**`
4. Dashboard → **Authentication → Emails → Templates → Confirm signup**: replace the body with [supabase/templates/confirmation.html](../supabase/templates/confirmation.html) (the `token_hash` link must point at `/auth/confirm`).
5. **SMTP (required for real signups):** Supabase's built-in sender is heavily rate-limited. Dashboard → Authentication → Emails → SMTP settings → use Resend's SMTP (host `smtp.resend.com`, user `resend`, password = your Resend API key) or any provider.
6. Copy from **Settings → API**: project URL, publishable (anon) key, secret (service role) key.

## 2. Resend (fan email is BYOK — per creator)

Fan-facing email (download links, review updates) is sent on **each creator's
own Resend key**, configured in their dashboard Settings → Email (Resend). The
platform is never billed for an artist's fans, and creators with no key still
deliver downloads via the fan's status page.

- There is **no platform-wide Resend env var** needed for fan email. (Creators
  add their own key + verified sender in-app; it's encrypted at rest in
  `creator_email_keys`, service-role only.)
- The only place a platform Resend account helps is **Supabase Auth SMTP**
  (creator signup-confirmation emails, step 1.5 below) — separate from fan mail.

## 3. Vercel project

1. Import the GitHub repo (`vividfeverdreams/vividdit`) at [vercel.com/new](https://vercel.com/new). Framework auto-detects Next.js.
2. Set environment variables (Production):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | hosted project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret key — server-only, never exposed |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` |
   | `API_KEY_ENCRYPTION_SECRET` | fresh `openssl rand -base64 32` — **not** the dev one. Losing/rotating it invalidates all stored creator OpenAI keys (they re-enter them; nothing else breaks). |
   | ~~`RESEND_API_KEY`~~ | Not used for fan email (BYOK per creator). Leave unset. |
   | ~~`EMAIL_FROM`~~ | Not used for fan email (creators set their own sender). Leave unset. |
   | `CRON_SECRET` | fresh `openssl rand -hex 24` — Vercel Cron sends it automatically |

3. Deploy. [vercel.json](../vercel.json) registers the daily cleanup cron (`/api/cron/cleanup`, 04:30 UTC) — confirm it appears under Project → Settings → Cron Jobs.
4. Add your custom domain under Project → Settings → Domains.

## 4. Post-deploy checklist

- [ ] Sign up a creator with a real email → confirmation arrives → verify → onboarding → dashboard.
- [ ] Save + test an OpenAI key in Settings → status **Valid**.
- [ ] Create and publish a gate with a real HQ file (large WAV exercises TUS).
- [ ] Visit the public gate URL logged-out: player renders, view event recorded.
- [ ] Complete a real fan unlock from a phone: actions on SoundCloud, one screenshot, AI verdict.
- [ ] Approve flow end-to-end: download works on the status page AND from the email link.
- [ ] `curl -H "authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/cleanup` → `{"ok":true,...}`.
- [ ] Confirm the HQ file is not fetchable at its public storage URL.

## Notes

- **Storage limits**: hosted Supabase free tier caps file size at 50MB — the 500MB `hq-files` limit needs the Pro plan (Dashboard → Storage → Settings → upload size, set ≥ 500MB).
- **Scaling the AI step**: verification runs inside Vercel's function timeout. The Responses call typically takes 5–15s; if you see timeouts on the Hobby plan (10s), bump the route's `maxDuration` or upgrade.
- **Key rotation**: creators' OpenAI keys are AES-256-GCM encrypted with `API_KEY_ENCRYPTION_SECRET`. Rotate by re-encrypting (future migration) or asking creators to re-enter keys.
