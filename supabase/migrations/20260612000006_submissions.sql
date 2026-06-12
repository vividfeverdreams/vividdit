-- Fan unlock submissions and their proof screenshots.
--
-- Fans are anonymous: all fan-side reads/writes go through server routes
-- using the service-role client (proof codes, IP hashing, and upload
-- validation happen server-side). The fan status page authenticates with
-- `status_token`, checked in the route — no anon policies here.

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  gate_id uuid not null references public.gates (id) on delete cascade,
  email text,
  -- fan_list: exported with the creator's fan list.
  -- review_status: collected only to notify a review outcome; never exported.
  email_purpose text check (email_purpose in ('fan_list', 'review_status')),
  email_consent boolean not null default false,
  proof_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'approved', 'rejected', 'needs_review')),
  -- Capability token for the fan's status page (and resubmission).
  status_token uuid not null default gen_random_uuid(),
  ip_hash text,
  user_agent text,
  fraud_flags jsonb not null default '[]'::jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index submissions_gate_id_idx on public.submissions (gate_id);
create index submissions_status_idx on public.submissions (gate_id, status);
create index submissions_ip_hash_idx on public.submissions (ip_hash);
create unique index submissions_status_token_idx on public.submissions (status_token);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

create table public.proof_images (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  storage_path text not null,
  exact_hash text not null,
  perceptual_hash text,
  created_at timestamptz not null default now()
);

create index proof_images_submission_id_idx on public.proof_images (submission_id);
-- Duplicate-screenshot detection.
create index proof_images_exact_hash_idx on public.proof_images (exact_hash);
create index proof_images_perceptual_hash_idx on public.proof_images (perceptual_hash);

alter table public.submissions enable row level security;
alter table public.proof_images enable row level security;

-- Creators see and decide submissions on their own gates.
create policy "submissions_select_own_gates"
  on public.submissions for select
  to authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = submissions.gate_id and g.creator_id = (select auth.uid())
    )
  );

create policy "submissions_update_own_gates"
  on public.submissions for update
  to authenticated
  using (
    exists (
      select 1 from public.gates g
      where g.id = submissions.gate_id and g.creator_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.gates g
      where g.id = submissions.gate_id and g.creator_id = (select auth.uid())
    )
  );

create policy "proof_images_select_own_gates"
  on public.proof_images for select
  to authenticated
  using (
    exists (
      select 1 from public.submissions s
      join public.gates g on g.id = s.gate_id
      where s.id = proof_images.submission_id and g.creator_id = (select auth.uid())
    )
  );
