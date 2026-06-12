-- One row per AI verification attempt. Written only by the server-side
-- verification pipeline (service role); creators get read access for the
-- review UI and cost transparency.

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  provider text not null default 'openai',
  model text not null,
  -- What was asked of the model (enabled requirements, track/artist, proof code).
  criteria jsonb not null,
  -- Full structured output from the model.
  result jsonb,
  decision text check (decision in ('approve', 'reject', 'review')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  input_tokens integer,
  output_tokens integer,
  error text,
  created_at timestamptz not null default now()
);

create index verification_runs_submission_id_idx on public.verification_runs (submission_id);

alter table public.verification_runs enable row level security;

create policy "verification_runs_select_own_gates"
  on public.verification_runs for select
  to authenticated
  using (
    exists (
      select 1 from public.submissions s
      join public.gates g on g.id = s.gate_id
      where s.id = verification_runs.submission_id and g.creator_id = (select auth.uid())
    )
  );
