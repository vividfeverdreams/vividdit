-- Instagram-follow and Spotify-follow gates, verified by AI screenshot the
-- same way SoundCloud follow is.

-- Profile URLs the fan must follow.
alter table public.gates
  add column instagram_url text,
  add column spotify_url text;

-- New platform toggles. Each is a single "follow" action (no sub-actions).
alter table public.gate_requirements
  add column instagram_enabled boolean not null default false,
  add column spotify_enabled boolean not null default false;

-- Which platform each proof screenshot is for (nullable for legacy rows).
alter table public.proof_images
  add column platform text check (platform in ('soundcloud', 'instagram', 'spotify'));

-- The inline checks ("a gate must require something", "a SoundCloud gate needs
-- an action") were created unnamed; drop all check constraints and re-add named
-- ones that account for the new platforms.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.gate_requirements'::regclass and contype = 'c'
  loop
    execute format('alter table public.gate_requirements drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.gate_requirements
  add constraint gate_requirements_soundcloud_actions
    check (not soundcloud_enabled or (require_like or require_repost or require_follow)),
  add constraint gate_requirements_requires_something
    check (email_enabled or soundcloud_enabled or instagram_enabled or spotify_enabled);