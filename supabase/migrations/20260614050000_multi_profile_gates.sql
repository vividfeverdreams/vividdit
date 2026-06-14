-- Multi-profile follow gates: a track with featured artists can require
-- following several profiles. Each follow target becomes its own fan step.
-- Replaces the single instagram_url/spotify_url and the soundcloud "follow
-- the artist" toggle. SoundCloud like/repost stay as track actions.

create table public.gate_follow_targets (
  id uuid primary key default gen_random_uuid(),
  gate_id uuid not null references public.gates (id) on delete cascade,
  platform text not null check (platform in ('soundcloud', 'instagram', 'spotify')),
  profile_url text not null,
  display_name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index gate_follow_targets_gate_id_idx on public.gate_follow_targets (gate_id);

alter table public.gate_follow_targets enable row level security;
grant all on public.gate_follow_targets to service_role;
grant select, insert, update, delete on public.gate_follow_targets to authenticated;
grant select on public.gate_follow_targets to anon;

-- Creators manage targets on their own gates.
create policy "follow_targets_all_own"
  on public.gate_follow_targets for all
  to authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = gate_follow_targets.gate_id and g.creator_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.gates g
      where g.id = gate_follow_targets.gate_id and g.creator_id = (select auth.uid())
    )
  );

-- Fans read targets for published gates.
create policy "follow_targets_select_published"
  on public.gate_follow_targets for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = gate_follow_targets.gate_id and g.status = 'published'
    )
  );

-- Which follow target a proof screenshot is for (null = the SoundCloud track
-- step proving like/repost).
alter table public.proof_images
  add column follow_target_id uuid references public.gate_follow_targets (id) on delete set null;

-- Backfill existing single-profile gates into follow targets.
insert into public.gate_follow_targets (gate_id, platform, profile_url, sort_order)
select g.id, 'soundcloud', p.soundcloud_profile_url, 0
from public.gates g
join public.gate_requirements r on r.gate_id = g.id
join public.profiles p on p.id = g.creator_id
where r.soundcloud_enabled and r.require_follow and p.soundcloud_profile_url is not null;

insert into public.gate_follow_targets (gate_id, platform, profile_url, sort_order)
select g.id, 'instagram', g.instagram_url, 1
from public.gates g
join public.gate_requirements r on r.gate_id = g.id
where r.instagram_enabled and g.instagram_url is not null;

insert into public.gate_follow_targets (gate_id, platform, profile_url, sort_order)
select g.id, 'spotify', g.spotify_url, 2
from public.gates g
join public.gate_requirements r on r.gate_id = g.id
where r.spotify_enabled and g.spotify_url is not null;