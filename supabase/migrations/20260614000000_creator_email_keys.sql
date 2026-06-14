-- BYOK Resend keys: each creator sends fan email (download links, rejections)
-- on their OWN Resend account, so the platform key is never billed for other
-- artists' fans. Same security model as creator_ai_keys: encrypted at rest,
-- RLS enabled with NO policies and NO grants — reachable only via the
-- service-role client in server code.

create table public.creator_email_keys (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'resend' check (provider = 'resend'),
  encrypted_key text not null,
  -- Verified sender, e.g. "Artist <noreply@artist.com>". Resend requires the
  -- domain to be verified in the creator's own account to reach real fans.
  from_email text not null,
  key_hint text,
  key_status text not null default 'untested' check (key_status in ('untested', 'valid', 'invalid')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, provider)
);

create trigger creator_email_keys_set_updated_at
  before update on public.creator_email_keys
  for each row execute function public.set_updated_at();

alter table public.creator_email_keys enable row level security;

-- Service-role only (no anon/authenticated grants — same as creator_ai_keys).
-- This generation of Supabase does not auto-grant new tables.
grant all on public.creator_email_keys to service_role;