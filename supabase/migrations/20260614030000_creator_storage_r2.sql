-- BYO Cloudflare R2 storage. Creators who connect their own R2 bucket host
-- their HQ files there (zero egress fees, their quota) and get unlimited
-- gates. Same security model as other BYOK tables: encrypted secret,
-- service-role only.

create table public.creator_storage_keys (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'r2' check (provider = 'r2'),
  account_id text not null,
  access_key_id text not null,
  encrypted_secret text not null,
  bucket text not null,
  -- Optional public/custom domain for serving (else we presign S3 GETs).
  public_base_url text,
  status text not null default 'untested'
    check (status in ('untested', 'valid', 'invalid')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, provider)
);

create trigger creator_storage_keys_set_updated_at
  before update on public.creator_storage_keys
  for each row execute function public.set_updated_at();

alter table public.creator_storage_keys enable row level security;
grant all on public.creator_storage_keys to service_role;

-- Where each HQ file lives. 'supabase' = our hq-files bucket (storage_path is
-- the object name); 'r2' = the creator's R2 bucket (storage_path is the key).
alter table public.download_assets
  add column storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase', 'r2'));