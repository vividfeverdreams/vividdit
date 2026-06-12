-- One-time-ish download grants for approved submissions. The raw token goes
-- in the fan's email/status page; only its hash is stored. Redemption happens
-- in a server route that checks expiry + use count, then mints a short-lived
-- signed storage URL.
--
-- Service-role only: RLS enabled with no policies.

create table public.download_tokens (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_uses integer not null default 5 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now()
);

create index download_tokens_submission_id_idx on public.download_tokens (submission_id);

alter table public.download_tokens enable row level security;
