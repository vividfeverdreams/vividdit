-- BYOK provider keys, encrypted at rest (AES-256-GCM, app-side).
--
-- SECURITY: RLS is enabled with NO policies — this table is reachable only
-- through the service-role client in server code. The ciphertext must never
-- be selectable with a client-side (anon/authenticated) key. The settings UI
-- reads key status via a server route that does its own auth check.

create table public.creator_ai_keys (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'openai' check (provider = 'openai'),
  encrypted_key text not null,
  key_status text not null default 'untested' check (key_status in ('untested', 'valid', 'invalid')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, provider)
);

create trigger creator_ai_keys_set_updated_at
  before update on public.creator_ai_keys
  for each row execute function public.set_updated_at();

alter table public.creator_ai_keys enable row level security;
