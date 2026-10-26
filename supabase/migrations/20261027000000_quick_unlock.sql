-- Quick unlock, instant download access, honest analytics and key health.
--
-- - gate_requirements.unlock_mode: 'quick' (fans tap through the follows, no
--   screenshots; the default for every gate) or 'verified' (one screenshot
--   per step, checked by the creator's AI key in the background).
-- - submissions.unlocked_at: when the fan got the download. Verified gates
--   unlock as soon as the screenshots are in; a later AI or creator rejection
--   revokes access to further downloads.
-- - submissions.download_emailed_at: the download email goes out once,
--   whichever path (quick unlock, AI, creator, auto-approve) gets there first.
-- - submissions.review_started_at: when a submission entered manual review;
--   anything still waiting 24 hours later is approved automatically.
-- - events: the app logs one 'view' per visitor per gate per day (client-side,
--   so link-preview bots don't count) plus 'start' and 'open' funnel steps.
-- - *_keys.alerted_at: a broken key emails the creator once, not nightly.

alter table public.gate_requirements
  add column unlock_mode text not null default 'quick'
    check (unlock_mode in ('quick', 'verified'));

alter table public.submissions
  add column unlocked_at timestamptz,
  add column download_emailed_at timestamptz,
  add column review_started_at timestamptz;

update public.submissions
set unlocked_at = coalesce(decided_at, updated_at)
where status = 'approved';

-- Approved fans were emailed when they were approved; never email them again.
update public.submissions
set download_emailed_at = coalesce(decided_at, updated_at)
where status = 'approved' and email is not null;

-- Reviews already waiting count from when the fan submitted, so auto-approve
-- clears them on its first run.
update public.submissions
set review_started_at = created_at
where status = 'needs_review';

alter table public.events drop constraint events_event_type_check;
alter table public.events
  add constraint events_event_type_check
  check (event_type in ('view', 'start', 'open', 'submit', 'approve', 'reject', 'download'));

-- visitor_id: a random id the fan's browser keeps (no personal data).
-- step: which unlock step an 'open' event belongs to.
alter table public.events
  add column visitor_id text check (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  add column step text check (char_length(step) <= 80);

-- ip_hash: salted hash of the sender's IP, so the public beacon can be
-- throttled per network (visitor ids are client-chosen).
alter table public.events add column ip_hash text;

create index events_visitor_idx
  on public.events (gate_id, visitor_id, event_type, created_at)
  where visitor_id is not null;
create index events_ip_idx
  on public.events (gate_id, ip_hash, created_at)
  where ip_hash is not null;

-- One view per visitor per gate per UTC day, and one 'open' per step, even
-- when two tabs report at the same moment. The beacon ignores the conflict.
create unique index events_visitor_daily_unique
  on public.events (
    gate_id,
    visitor_id,
    event_type,
    coalesce(step, ''),
    ((timezone('UTC', created_at))::date)
  )
  where visitor_id is not null and event_type in ('view', 'open');

alter table public.creator_ai_keys add column alerted_at timestamptz;
alter table public.creator_email_keys add column alerted_at timestamptz;

-- Downloads count fans, not clicks: a fan may re-download up to ten times.
create or replace view public.gate_stats
with (security_invoker = on) as
select
  g.id as gate_id,
  count(e.id) filter (where e.event_type = 'view') as views,
  count(distinct e.submission_id) filter (where e.event_type = 'download') as downloads,
  (
    select count(*)
    from public.submissions s
    where s.gate_id = g.id
      and s.email_purpose = 'fan_list'
      and s.email is not null
  ) as emails
from public.gates g
left join public.events e on e.gate_id = g.id
group by g.id;

-- Per-gate funnel for the signed-in creator. security invoker: RLS on gates,
-- events and submissions still applies, and the creator filter keeps other
-- artists' published gates out of the result.
create or replace function public.gate_funnel(p_since timestamptz default null)
returns table (
  gate_id uuid,
  visitors bigint,
  starts bigint,
  opens bigint,
  unlocks bigint,
  downloads bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.id,
    (
      select count(*) from public.events e
      where e.gate_id = g.id and e.event_type = 'view'
        and e.created_at >= coalesce(p_since, '-infinity'::timestamptz)
    ),
    (
      select count(*) from public.submissions s
      where s.gate_id = g.id
        and s.user_agent is distinct from 'vividdit:vault-rescue-link'
        and s.created_at >= coalesce(p_since, '-infinity'::timestamptz)
    ),
    (
      select count(distinct coalesce(e.submission_id::text, e.visitor_id))
      from public.events e
      where e.gate_id = g.id and e.event_type = 'open'
        and e.created_at >= coalesce(p_since, '-infinity'::timestamptz)
    ),
    (
      select count(*) from public.submissions s
      where s.gate_id = g.id
        and s.unlocked_at is not null
        and s.status <> 'rejected'
        and s.user_agent is distinct from 'vividdit:vault-rescue-link'
        and s.created_at >= coalesce(p_since, '-infinity'::timestamptz)
    ),
    (
      select count(distinct e.submission_id) from public.events e
      where e.gate_id = g.id and e.event_type = 'download'
        and e.created_at >= coalesce(p_since, '-infinity'::timestamptz)
    )
  from public.gates g
  where g.creator_id = (select auth.uid());
$$;

revoke execute on function public.gate_funnel(timestamptz) from public, anon;
grant execute on function public.gate_funnel(timestamptz) to authenticated;

-- Visitors per day and where they came from, aggregated in the database (the
-- API returns at most 1,000 rows, so the dashboard can't count raw events).
create or replace function public.gate_daily_views(p_since timestamptz)
returns table (day date, views bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select (timezone('UTC', e.created_at))::date, count(*)
  from public.events e
  join public.gates g on g.id = e.gate_id
  where g.creator_id = (select auth.uid())
    and e.event_type = 'view'
    and e.created_at >= p_since
  group by 1
  order by 1;
$$;

create or replace function public.gate_view_sources(p_since timestamptz default null)
returns table (source text, views bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(
      nullif(e.utm_source, ''),
      nullif(e.source, ''),
      substring(e.referrer from '^https?://(?:www\.)?([^/:?#]+)'),
      'No source'
    ),
    count(*)
  from public.events e
  join public.gates g on g.id = e.gate_id
  where g.creator_id = (select auth.uid())
    and e.event_type = 'view'
    and e.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  group by 1
  order by 2 desc
  limit 20;
$$;

revoke execute on function public.gate_daily_views(timestamptz) from public, anon;
revoke execute on function public.gate_view_sources(timestamptz) from public, anon;
grant execute on function public.gate_daily_views(timestamptz) to authenticated;
grant execute on function public.gate_view_sources(timestamptz) to authenticated;
