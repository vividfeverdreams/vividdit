-- Per-gate stats for the dashboard list. security_invoker so the underlying
-- RLS (creator sees only their own gates/events/submissions) applies to the
-- querying user.
create view public.gate_stats
with (security_invoker = on) as
select
  g.id as gate_id,
  count(e.id) filter (where e.event_type = 'view') as views,
  count(e.id) filter (where e.event_type = 'download') as downloads,
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

grant select on public.gate_stats to authenticated;
