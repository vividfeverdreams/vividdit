# Free BYOK SoundCloud Download Gate MVP

## Context
Build a free-to-use SaaS replacement for the old Hypeddit-style SoundCloud download gate. The core problem: SoundCloud paused Hypeddit’s API access, so Hypeddit can no longer require/verify follow, like, and repost actions before unlocking downloads. This product keeps the growth loop alive without controlling the fan’s browser or using SoundCloud’s API.

Fans discover the public track on SoundCloud, click a “Free Download”/Buy-link to this platform, and arrive already intending to download the HQ file. The main SoundCloud track stays public and discoverable. The HQ WAV/AIFF/ZIP file is gated behind creator-selected requirements.

## Product Flow
- **Creator flow**
  - Sign up/login.
  - Complete artist profile: artist name, SoundCloud profile URL, default branding.
  - Add OpenAI API key in settings before publishing any AI SoundCloud gate.
  - Create Download Gate: paste SoundCloud track URL, upload HQ download file, enter artist/title, customize cover/theme, configure gates, choose slug, publish.
  - Manage submissions, manual reviews, fan emails, and basic analytics from dashboard.

- **Fan flow**
  - Land on public gate URL from SoundCloud.
  - See embedded SoundCloud player and unlock requirements immediately; no listen threshold.
  - Complete enabled gates:
    - Email Gate: submit email/consent.
    - SoundCloud Gate: manually like, repost, and/or follow depending on creator toggles.
  - Upload proof screenshots.
  - AI verifies screenshots using the creator’s own OpenAI key.
  - If approved, fan receives a short-lived signed download link.
  - If uncertain, creator reviews the submission.

## MVP Feature Decisions
- Stack: **Next.js App Router + TypeScript + Supabase Auth/Postgres/Storage + Vercel**.
- AI provider: **OpenAI only for MVP**.
- API-key model: **BYOK, encrypted stored creator key**.
- Recommended verification model: **GPT-5.4 mini**.
  - Default model is hidden behind advanced settings.
  - Rationale: strong vision/classification quality at much lower cost than GPT-5.4/GPT-5.5.
  - Current listed pricing: GPT-5.4 mini at `$0.75 / 1M input tokens`, `$4.50 / 1M output tokens`; GPT-5.4 nano is cheaper but not the launch default because false proof decisions are the product risk.
- Gate logic: if Email Gate and SoundCloud Gate are both enabled, **all enabled requirements must pass**.
- SoundCloud actions: creator can independently toggle `like`, `repost`, and `follow`.
- Manual review owner: **creator reviews uncertain submissions**.
- Public URLs: creator chooses immutable slug before publish, e.g. `/artist-name/song-name`.
- MVP extras: capture UTM/source/referrer and provide CSV exports; defer billing, tracking pixels, custom domains, Spotify gates, and platform discovery.

## Implementation Changes
- **Creator dashboard**
  - Pages: Download Gates, Create Gate wizard, Reviews, Fans, Analytics, Settings.
  - Settings includes encrypted OpenAI key entry, “test key” action, key status, and last verification error.
  - Email-only gates can publish without an OpenAI key; SoundCloud AI gates cannot.

- **Gate builder**
  - Steps: SoundCloud URL → HQ file upload → artist/title → design → gate steps → slug → confirmation.
  - Embed SoundCloud track using the official SoundCloud player/widget.
  - Do not rely on the widget for like/repost/follow verification; it only supports playback/UI events, not proof of those social actions.
  - Store HQ downloads in private storage and only release via signed URLs.

- **Fan page**
  - Show SoundCloud embed, track metadata, cover art, and unlock panel immediately.
  - Generate a unique proof code per submission, such as `GATE-4821`.
  - Ask fans to include the proof code in screenshots when possible; missing code lowers confidence but does not automatically fail.
  - Screenshot instructions adapt to enabled toggles:
    - Like: show target track page with active liked state.
    - Repost: show target track page with active reposted state.
    - Follow: show artist profile with active following state.

- **AI verification**
  - Server-side endpoint loads creator’s encrypted OpenAI key, calls OpenAI Responses API with image inputs and Structured Outputs.
  - Use a strict JSON result:
    - `decision`: `approve | reject | review`
    - `confidence`: number
    - `track_match`, `artist_match`, `like_confirmed`, `repost_confirmed`, `follow_confirmed`
    - `proof_code_visible`, `tampering_suspected`
    - `missing_requirements`: string array
    - `fan_message`: short retry/rejection explanation
  - Auto-approve when confidence is `>= 0.90`, no tampering is suspected, and every enabled requirement is confirmed.
  - Auto-reject only obvious failures, such as wrong platform, wrong artist/track, or missing all required proof.
  - Route ambiguous cases to creator review.

- **Manual review**
  - Creator sees submitted screenshots, AI result, missing requirements, and approve/reject buttons.
  - Approve sends or displays a signed download link.
  - Reject asks fan to resubmit clearer proof.
  - If Email Gate is off and manual review is needed, collect a status-only email that is not exported as a fan-list email.

- **Security and anti-fraud**
  - Never expose creator OpenAI keys to the browser or fan.
  - Encrypt API keys at rest; decrypt only inside server-side verification.
  - Store screenshot exact hash and perceptual hash.
  - Block exact duplicate screenshot reuse.
  - Flag repeated IP/device/email patterns for review.
  - Limit proof uploads to JPG/PNG/WEBP, max 5 files, max 10MB each.
  - Delete proof screenshots after 30 days unless tied to unresolved review.
  - Enable Supabase RLS so creators only access their own gates, assets, submissions, reviews, and fan data.

## Data Model
- `profiles`: creator account, artist name, SoundCloud profile URL, branding defaults.
- `creator_ai_keys`: creator ID, provider `openai`, encrypted key, key status, last tested timestamp.
- `gates`: creator ID, title, artist, SoundCloud URL, slug, status, theme, cover path.
- `gate_requirements`: gate ID, email enabled, SoundCloud enabled, like/repost/follow booleans.
- `download_assets`: gate ID, private storage path, filename, size, MIME type.
- `submissions`: gate ID, email, email purpose `fan_list | review_status`, proof code, status, IP hash, user agent, timestamps.
- `proof_images`: submission ID, private storage path, exact hash, perceptual hash.
- `verification_runs`: submission ID, provider, model, criteria JSON, result JSON, decision, confidence, token usage, error.
- `events`: gate ID, submission ID, event type, UTM/referrer/source metadata.

## Test Plan
- Creator can sign up, save/test OpenAI key, create a gate, upload HQ file, publish slug, and copy URL.
- Email-only gate publishes and unlocks without an OpenAI key.
- SoundCloud gate cannot publish until creator has a valid OpenAI key.
- Like/repost/follow toggles update fan instructions and AI criteria.
- Fan can complete email-only, SoundCloud-only, and email + SoundCloud gates.
- AI auto-approves strong proof, rejects clear failures, and routes ambiguous proof to review.
- Creator can approve/reject review submissions.
- Signed download links expire and private files cannot be accessed directly.
- Duplicate screenshots are blocked or flagged.
- CSV export excludes status-only review emails.
- RLS prevents cross-creator access.

## Assumptions And References
- This product does not automate SoundCloud actions, log into fan accounts, or use SoundCloud’s API for engagement actions.
- SoundCloud remains the discovery/listening platform; this app gates only the HQ download.
- BYOK adds moderate complexity, estimated at roughly 15-25% over a platform-owned OpenAI key implementation.
- Sources: [Hypeddit Download Gate flow](https://hypeddit.zendesk.com/hc/en-us/articles/11803413280663-Create-Download-Gates), [Hypeddit SoundCloud API change](https://hypeddit.com/news/a-change-to-soundcloud-download-gates/), [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget), [OpenAI GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [OpenAI vision docs](https://developers.openai.com/api/docs/guides/images-vision), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
