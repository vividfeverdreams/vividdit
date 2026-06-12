-- Analytics events: page views, submissions, decisions, downloads.
-- Written server-side (service role); creators read their own gates' events.

create table public.events (
  id bigint generated always as identity primary key,
  gate_id uuid not null references public.gates (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete set null,
  event_type text not null
    check (event_type in ('view', 'submit', 'approve', 'reject', 'download')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  source text,
  created_at timestamptz not null default now()
);

create index events_gate_id_idx on public.events (gate_id, created_at);
create index events_type_idx on public.events (gate_id, event_type);

alter table public.events enable row level security;

create policy "events_select_own_gates"
  on public.events for select
  to authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = events.gate_id and g.creator_id = (select auth.uid())
    )
  );
