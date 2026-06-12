-- The gated HQ file. One asset per gate for MVP.
-- Files live in the private `hq-files` bucket; released only via signed URLs.

create table public.download_assets (
  id uuid primary key default gen_random_uuid(),
  gate_id uuid not null unique references public.gates (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  size_bytes bigint not null check (size_bytes > 0),
  mime_type text not null,
  created_at timestamptz not null default now()
);

alter table public.download_assets enable row level security;

create policy "download_assets_all_own"
  on public.download_assets for all
  to authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = download_assets.gate_id and g.creator_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.gates g
      where g.id = download_assets.gate_id and g.creator_id = (select auth.uid())
    )
  );

-- Fans never read this table directly; download delivery goes through
-- server routes (signed URLs / download tokens).
