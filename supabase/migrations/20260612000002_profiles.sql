-- Creator profiles. One row per auth user, created automatically on signup.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  artist_name text,
  -- Public URL namespace for the creator's gates: /<artist_slug>/<gate_slug>.
  -- Immutable once set (published URLs must never break).
  artist_slug text unique check (artist_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(artist_slug) between 3 and 60),
  soundcloud_profile_url text,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.prevent_artist_slug_change()
returns trigger
language plpgsql
as $$
begin
  if old.artist_slug is not null and new.artist_slug is distinct from old.artist_slug then
    raise exception 'artist_slug is immutable once set';
  end if;
  return new;
end;
$$;

create trigger profiles_artist_slug_immutable
  before update on public.profiles
  for each row execute function public.prevent_artist_slug_change();

-- Auto-create a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- Creators read/update their own profile. Inserts happen via the signup
-- trigger (security definer); no client-side insert or delete.
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Anon read access for published-gate artist identity is added in the gates
-- migration (the policy references public.gates).
