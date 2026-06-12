-- Download gates and their unlock requirements.

create table public.gates (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  artist text not null check (char_length(artist) between 1 and 200),
  soundcloud_url text not null,
  -- Public URL segment: /<artist_slug>/<slug>. Immutable once published.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  theme jsonb not null default '{}'::jsonb,
  cover_path text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, slug)
);

create index gates_creator_id_idx on public.gates (creator_id);

create trigger gates_set_updated_at
  before update on public.gates
  for each row execute function public.set_updated_at();

-- Published URLs must never break: slug locks at first publish.
create or replace function public.enforce_gate_publish_rules()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.published_at is not null and new.slug is distinct from old.slug then
      raise exception 'slug is immutable after publish';
    end if;
    if new.status = 'published' and old.published_at is null then
      new.published_at = now();
    end if;
  elsif tg_op = 'INSERT' then
    if new.status = 'published' then
      new.published_at = now();
    end if;
  end if;
  return new;
end;
$$;

create trigger gates_publish_rules
  before insert or update on public.gates
  for each row execute function public.enforce_gate_publish_rules();

create table public.gate_requirements (
  gate_id uuid primary key references public.gates (id) on delete cascade,
  email_enabled boolean not null default true,
  soundcloud_enabled boolean not null default false,
  require_like boolean not null default false,
  require_repost boolean not null default false,
  require_follow boolean not null default false,
  updated_at timestamptz not null default now(),
  -- A SoundCloud gate must require at least one action.
  check (not soundcloud_enabled or (require_like or require_repost or require_follow)),
  -- A gate must require something.
  check (email_enabled or soundcloud_enabled)
);

create trigger gate_requirements_set_updated_at
  before update on public.gate_requirements
  for each row execute function public.set_updated_at();

alter table public.gates enable row level security;
alter table public.gate_requirements enable row level security;

-- Creators manage their own gates.
create policy "gates_all_own"
  on public.gates for all
  to authenticated
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()));

create policy "gate_requirements_all_own"
  on public.gate_requirements for all
  to authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = gate_requirements.gate_id and g.creator_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.gates g
      where g.id = gate_requirements.gate_id and g.creator_id = (select auth.uid())
    )
  );

-- Fans (anon) can read published gates and their requirements.
create policy "gates_select_published"
  on public.gates for select
  to anon, authenticated
  using (status = 'published');

create policy "gate_requirements_select_published"
  on public.gate_requirements for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = gate_requirements.gate_id and g.status = 'published'
    )
  );

-- Fan pages need the artist's public identity for published gates.
-- All profile columns are public-facing by design (name, slug, SoundCloud
-- URL, branding) — no sensitive data lives here.
create policy "profiles_select_public_published"
  on public.profiles for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.creator_id = profiles.id and g.status = 'published'
    )
  );
