-- Durable proof-upload reservations.
--
-- Fan uploads go directly to private Storage through short-lived signed URLs.
-- The service-role-only batch row owns the exact object paths and reserves
-- proof capacity before those URLs are minted. Database functions serialize
-- reserve/complete/discard transitions so parallel browser requests cannot
-- exceed the submission cap, commit unowned objects, or start verification
-- more than once.

-- Older application versions could insert the same path more than once. Keep
-- the oldest row before adding the invariant used by atomic completion.
alter table public.proof_images
  add column byte_size bigint not null default 0
    check (byte_size between 0 and 10485760);

alter table public.submissions
  add column verification_dispatched_at timestamptz,
  add column verification_dispatch_token uuid;

create index submissions_stale_verification_dispatch_idx
  on public.submissions (verification_dispatched_at)
  where status = 'verifying';

comment on column public.proof_images.byte_size is
  'Server-observed object bytes. Legacy rows are 0 because their original size was not persisted.';

with ranked_proof_paths as (
  select
    id,
    row_number() over (
      partition by submission_id, storage_path
      order by created_at, id
    ) as position
  from public.proof_images
)
delete from public.proof_images p
using ranked_proof_paths ranked
where p.id = ranked.id
  and ranked.position > 1;

create unique index proof_images_submission_storage_path_unique
  on public.proof_images (submission_id, storage_path);

create table public.proof_upload_batches (
  id uuid primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  storage_paths text[] not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'discarded', 'expired')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  discarded_at timestamptz,
  expired_at timestamptz,
  cleanup_claimed_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proof_upload_batches_path_count
    check (cardinality(storage_paths) between 1 and 10),
  constraint proof_upload_batches_paths_not_null
    check (array_position(storage_paths, null) is null)
);

create index proof_upload_batches_submission_active_idx
  on public.proof_upload_batches (submission_id, expires_at)
  where status = 'active';
create index proof_upload_batches_cleanup_idx
  on public.proof_upload_batches (expires_at, cleanup_claimed_at)
  where status in ('discarded', 'expired') and cleaned_at is null;

create trigger proof_upload_batches_set_updated_at
  before update on public.proof_upload_batches
  for each row execute function public.set_updated_at();

alter table public.proof_upload_batches enable row level security;
revoke all on table public.proof_upload_batches from public, anon, authenticated;
grant select, insert, update, delete on table public.proof_upload_batches
  to service_role;

create or replace function public.reserve_proof_upload_batch(
  p_batch_id uuid,
  p_submission_id uuid,
  p_status_token uuid,
  p_storage_paths text[]
)
returns table(batch_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate_id uuid;
  v_submission_status text;
  v_committed integer;
  v_reserved integer;
  v_expires_at timestamptz := now() + interval '2 hours 5 minutes';
  v_prefix text;
begin
  if p_batch_id is null
    or p_submission_id is null
    or p_status_token is null
    or p_storage_paths is null
    or cardinality(p_storage_paths) not between 1 and 10
  then
    raise exception 'Invalid proof upload reservation.';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'proof-upload:submission:' || p_submission_id::text,
      0
    )
  );

  select s.gate_id, s.status
  into v_gate_id, v_submission_status
  from public.submissions s
  where s.id = p_submission_id
    and s.status_token = p_status_token
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;
  if v_submission_status not in ('pending', 'rejected') then
    raise exception 'This submission is not accepting screenshots.';
  end if;

  v_prefix := v_gate_id::text || '/' || p_submission_id::text ||
    '/uploads/' || p_batch_id::text || '/';

  if (
    select count(distinct owned.path) <> cardinality(p_storage_paths)
      or bool_or(
        owned.path is null
        or left(owned.path, length(v_prefix)) <> v_prefix
        or substring(owned.path from length(v_prefix) + 1) !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
      )
    from unnest(p_storage_paths) as owned(path)
  ) then
    raise exception 'Invalid proof upload path.';
  end if;

  update public.proof_upload_batches b
  set status = 'expired', expired_at = coalesce(b.expired_at, now())
  where b.submission_id = p_submission_id
    and b.status = 'active'
    and b.expires_at <= now();

  select count(*)::integer
  into v_committed
  from public.proof_images p
  where p.submission_id = p_submission_id;

  select coalesce(sum(cardinality(b.storage_paths)), 0)::integer
  into v_reserved
  from public.proof_upload_batches b
  where b.submission_id = p_submission_id
    and b.status = 'active'
    and b.expires_at > now();

  if v_committed + v_reserved + cardinality(p_storage_paths) > 15 then
    raise exception 'Too many screenshots on this submission.';
  end if;

  insert into public.proof_upload_batches (
    id,
    submission_id,
    storage_paths,
    status,
    expires_at
  ) values (
    p_batch_id,
    p_submission_id,
    p_storage_paths,
    'active',
    v_expires_at
  );

  return query select p_batch_id, v_expires_at;
end;
$$;

create or replace function public.complete_proof_upload_batch(
  p_batch_id uuid,
  p_submission_id uuid,
  p_status_token uuid,
  p_proofs jsonb,
  p_platform text default 'soundcloud',
  p_follow_target_id uuid default null,
  p_near_duplicate boolean default false,
  p_finalize boolean default true
)
returns table(proof_count integer, should_verify boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate_id uuid;
  v_submission_status text;
  v_batch_status text;
  v_batch_expires_at timestamptz;
  v_owned_paths text[];
  v_sorted_owned_paths text[];
  v_input_paths text[];
  v_proof_count integer;
  v_committed integer;
  v_reserved integer;
  v_committed_bytes bigint;
  v_incoming_bytes bigint;
begin
  if p_batch_id is null
    or p_submission_id is null
    or p_status_token is null
    or p_proofs is null
    or jsonb_typeof(p_proofs) <> 'array'
  then
    raise exception 'Invalid proof upload completion.';
  end if;

  v_proof_count := jsonb_array_length(p_proofs);
  if v_proof_count not between 1 and 10 then
    raise exception 'Invalid proof upload completion.';
  end if;
  if p_platform is null
    or p_platform not in ('soundcloud', 'instagram', 'spotify')
    or p_finalize is null
  then
    raise exception 'Invalid proof platform.';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'proof-upload:submission:' || p_submission_id::text,
      0
    )
  );

  select s.gate_id, s.status
  into v_gate_id, v_submission_status
  from public.submissions s
  where s.id = p_submission_id
    and s.status_token = p_status_token
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;
  if v_submission_status not in ('pending', 'rejected') then
    raise exception 'This submission is not accepting screenshots.';
  end if;

  select b.status, b.expires_at, b.storage_paths
  into v_batch_status, v_batch_expires_at, v_owned_paths
  from public.proof_upload_batches b
  where b.id = p_batch_id
    and b.submission_id = p_submission_id
  for update;

  if not found then
    raise exception 'Upload batch not found.';
  end if;
  if v_batch_status <> 'active' then
    raise exception 'This upload batch is no longer active.';
  end if;
  if v_batch_expires_at <= now() then
    raise exception 'This screenshot upload expired. Try again.';
  end if;

  select
    array_agg(proof.storage_path order by proof.storage_path),
    count(*)::integer
  into v_input_paths, v_proof_count
  from jsonb_to_recordset(p_proofs) as proof(
    storage_path text,
    exact_hash text,
    perceptual_hash text
  );

  select array_agg(path order by path)
  into v_sorted_owned_paths
  from unnest(v_owned_paths) as owned(path);

  if v_input_paths is distinct from v_sorted_owned_paths
    or v_proof_count <> cardinality(v_owned_paths)
    or exists (
      select 1
      from jsonb_to_recordset(p_proofs) as proof(
        storage_path text,
        exact_hash text,
        perceptual_hash text,
        byte_size bigint
      )
      where proof.storage_path is null
        or proof.exact_hash is null
        or proof.exact_hash !~ '^[0-9a-f]{64}$'
        or (
          proof.perceptual_hash is not null
          and proof.perceptual_hash !~ '^[0-9a-f]{16}$'
        )
        or proof.byte_size is null
        or proof.byte_size not between 1 and 10485760
    )
  then
    raise exception 'The uploaded screenshots do not match this batch.';
  end if;

  if (
    select count(distinct proof.exact_hash) <> v_proof_count
    from jsonb_to_recordset(p_proofs) as proof(
      storage_path text,
      exact_hash text,
      perceptual_hash text,
      byte_size bigint
    )
  ) then
    raise exception 'The same screenshot was uploaded more than once.';
  end if;

  -- Gate-level serialization makes the exact-hash check authoritative across
  -- different submissions completing concurrently for the same gate.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('proof-upload:gate:' || v_gate_id::text, 0)
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_proofs) as proof(
      storage_path text,
      exact_hash text,
      perceptual_hash text,
      byte_size bigint
    )
    join public.proof_images existing
      on existing.exact_hash = proof.exact_hash
    join public.submissions existing_submission
      on existing_submission.id = existing.submission_id
    where existing_submission.gate_id = v_gate_id
      and existing.submission_id <> p_submission_id
  ) then
    raise exception 'One of these screenshots was already used for this gate. Take fresh screenshots of your own account.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_proofs) as proof(
      storage_path text,
      exact_hash text,
      perceptual_hash text,
      byte_size bigint
    )
    join public.proof_images existing
      on existing.exact_hash = proof.exact_hash
    where existing.submission_id = p_submission_id
  ) then
    raise exception 'One of these screenshots is already attached to this submission.';
  end if;

  select count(*)::integer
  into v_committed
  from public.proof_images p
  where p.submission_id = p_submission_id;

  select coalesce(sum(cardinality(b.storage_paths)), 0)::integer
  into v_reserved
  from public.proof_upload_batches b
  where b.submission_id = p_submission_id
    and b.status = 'active'
    and b.expires_at > now();

  if v_committed + v_reserved > 15 then
    raise exception 'Too many screenshots on this submission.';
  end if;

  select coalesce(sum(p.byte_size), 0)
  into v_committed_bytes
  from public.proof_images p
  where p.submission_id = p_submission_id;

  select coalesce(sum(proof.byte_size), 0)
  into v_incoming_bytes
  from jsonb_to_recordset(p_proofs) as proof(
    storage_path text,
    exact_hash text,
    perceptual_hash text,
    byte_size bigint
  );

  if v_committed_bytes + v_incoming_bytes > 26214400 then
    raise exception 'Screenshots must be 25MB or less in total.';
  end if;

  insert into public.proof_images (
    submission_id,
    storage_path,
    exact_hash,
    perceptual_hash,
    byte_size,
    platform,
    follow_target_id
  )
  select
    p_submission_id,
    proof.storage_path,
    proof.exact_hash,
    proof.perceptual_hash,
    proof.byte_size,
    p_platform,
    p_follow_target_id
  from jsonb_to_recordset(p_proofs) as proof(
    storage_path text,
    exact_hash text,
    perceptual_hash text,
    byte_size bigint
  );

  update public.submissions s
  set
    fraud_flags = case
      when coalesce(p_near_duplicate, false)
        and not (coalesce(s.fraud_flags, '[]'::jsonb) ? 'similar_screenshot')
      then coalesce(s.fraud_flags, '[]'::jsonb) ||
        jsonb_build_array('similar_screenshot')
      else coalesce(s.fraud_flags, '[]'::jsonb)
    end,
    status = case when p_finalize then 'verifying' else 'pending' end,
    verification_dispatched_at = case
      when p_finalize then null
      else s.verification_dispatched_at
    end,
    verification_dispatch_token = case
      when p_finalize then null
      else s.verification_dispatch_token
    end,
    decided_at = null
  where s.id = p_submission_id;

  if p_finalize then
    insert into public.events (gate_id, submission_id, event_type)
    values (v_gate_id, p_submission_id, 'submit');
  end if;

  update public.proof_upload_batches b
  set status = 'completed', completed_at = now()
  where b.id = p_batch_id
    and b.status = 'active';

  return query select v_proof_count, p_finalize;
end;
$$;

create or replace function public.discard_proof_upload_batch(
  p_batch_id uuid,
  p_submission_id uuid,
  p_status_token uuid
)
returns table(owned_paths text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  if p_batch_id is null or p_submission_id is null or p_status_token is null then
    raise exception 'Invalid proof upload batch.';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'proof-upload:submission:' || p_submission_id::text,
      0
    )
  );

  perform 1
  from public.submissions s
  where s.id = p_submission_id
    and s.status_token = p_status_token
  for update;
  if not found then
    raise exception 'Submission not found.';
  end if;

  update public.proof_upload_batches b
  set status = 'discarded', discarded_at = now()
  where b.id = p_batch_id
    and b.submission_id = p_submission_id
    and b.status = 'active'
  returning b.storage_paths into v_paths;

  if v_paths is not null then
    return query select v_paths;
  end if;
end;
$$;

create or replace function public.claim_submission_verification(
  p_submission_id uuid,
  p_status_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate_id uuid;
  v_status text;
begin
  if p_submission_id is null or p_status_token is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'proof-upload:submission:' || p_submission_id::text,
      0
    )
  );

  select s.gate_id, s.status
  into v_gate_id, v_status
  from public.submissions s
  where s.id = p_submission_id
    and s.status_token = p_status_token
  for update;

  if not found or v_status not in ('pending', 'rejected') then
    return false;
  end if;

  update public.submissions
  set
    status = 'verifying',
    verification_dispatched_at = null,
    verification_dispatch_token = null,
    decided_at = null
  where id = p_submission_id;

  insert into public.events (gate_id, submission_id, event_type)
  values (v_gate_id, p_submission_id, 'submit');

  return true;
end;
$$;

create or replace function public.claim_submission_verification_dispatch(
  p_submission_id uuid,
  p_status_token uuid,
  p_dispatch_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_submission_id is null
    or p_status_token is null
    or p_dispatch_token is null
  then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'proof-upload:submission:' || p_submission_id::text,
      0
    )
  );

  update public.submissions s
  set
    verification_dispatched_at = now(),
    verification_dispatch_token = p_dispatch_token
  where s.id = p_submission_id
    and s.status_token = p_status_token
    and s.status = 'verifying'
    and (
      s.verification_dispatch_token is null
      or s.verification_dispatch_token = p_dispatch_token
      or s.verification_dispatched_at < now() - interval '3 minutes'
    );

  return found;
end;
$$;

create or replace function public.claim_expired_proof_upload_batches(
  p_limit integer default 200
)
returns table(batch_id uuid, owned_paths text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Invalid cleanup limit.';
  end if;

  update public.proof_upload_batches b
  set status = 'expired', expired_at = coalesce(b.expired_at, now())
  where b.status = 'active'
    and b.expires_at <= now();

  return query
  with candidates as (
    select b.id
    from public.proof_upload_batches b
    where b.status in ('discarded', 'expired')
      and b.expires_at <= now()
      and b.cleaned_at is null
      and (
        b.cleanup_claimed_at is null
        or b.cleanup_claimed_at < now() - interval '15 minutes'
      )
      and not exists (
        select 1
        from public.proof_images p
        where p.submission_id = b.submission_id
          and p.storage_path = any(b.storage_paths)
      )
    order by b.expires_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.proof_upload_batches b
    set cleanup_claimed_at = now()
    from candidates c
    where b.id = c.id
    returning b.id, b.storage_paths
  )
  select claimed.id, claimed.storage_paths
  from claimed;
end;
$$;

create or replace function public.mark_proof_upload_batch_cleaned(
  p_batch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.proof_upload_batches b
  set cleaned_at = now()
  where b.id = p_batch_id
    and b.status in ('discarded', 'expired')
    and b.expires_at <= now()
    and b.cleaned_at is null
    and not exists (
      select 1
      from public.proof_images p
      where p.submission_id = b.submission_id
        and p.storage_path = any(b.storage_paths)
    );
  return found;
end;
$$;

revoke all on function public.reserve_proof_upload_batch(uuid, uuid, uuid, text[])
  from public, anon, authenticated;
revoke all on function public.complete_proof_upload_batch(uuid, uuid, uuid, jsonb, text, uuid, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.discard_proof_upload_batch(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_submission_verification(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_submission_verification_dispatch(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_expired_proof_upload_batches(integer)
  from public, anon, authenticated;
revoke all on function public.mark_proof_upload_batch_cleaned(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_proof_upload_batch(uuid, uuid, uuid, text[])
  to service_role;
grant execute on function public.complete_proof_upload_batch(uuid, uuid, uuid, jsonb, text, uuid, boolean, boolean)
  to service_role;
grant execute on function public.discard_proof_upload_batch(uuid, uuid, uuid)
  to service_role;
grant execute on function public.claim_submission_verification(uuid, uuid)
  to service_role;
grant execute on function public.claim_submission_verification_dispatch(uuid, uuid, uuid)
  to service_role;
grant execute on function public.claim_expired_proof_upload_batches(integer)
  to service_role;
grant execute on function public.mark_proof_upload_batch_cleaned(uuid)
  to service_role;

-- Artist-controlled emergency access to a published Complete Vault.
--
-- Rescue links reuse the existing high-entropy submission status capability,
-- but creation, rotation, and vault disable must serialize on the vault. This
-- prevents concurrent dashboard requests from leaving more than one active
-- link or minting a link immediately after the vault was disabled.

-- Deduplicate any manually-created legacy rescue rows before enforcing the
-- single-active-link invariant. The rescue RPC behavior below is unchanged.
with ranked_rescue_links as (
  select
    id,
    row_number() over (
      partition by gate_id
      order by created_at desc, id desc
    ) as position
  from public.submissions
  where status = 'approved'
    and proof_code = 'VIVIDDIT-VAULT-RESCUE'
    and user_agent = 'vividdit:vault-rescue-link'
)
update public.submissions s
set status = 'rejected', decided_at = now()
from ranked_rescue_links ranked
where s.id = ranked.id
  and ranked.position > 1;

create unique index submissions_one_active_vault_rescue
  on public.submissions (gate_id)
  where status = 'approved'
    and proof_code = 'VIVIDDIT-VAULT-RESCUE'
    and user_agent = 'vividdit:vault-rescue-link';

create or replace function public.mint_vault_rescue_link(
  p_vault_id uuid,
  p_rotate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_vault_id::text, 0)
  );

  if not exists (
    select 1
    from public.gates g
    where g.id = p_vault_id
      and g.creator_id = (select auth.uid())
      and g.kind = 'vault'
      and g.status = 'published'
  ) then
    raise exception 'Published vault not found';
  end if;

  if p_rotate then
    update public.submissions
    set status = 'rejected', decided_at = now()
    where gate_id = p_vault_id
      and status = 'approved'
      and proof_code = 'VIVIDDIT-VAULT-RESCUE'
      and user_agent = 'vividdit:vault-rescue-link';
  end if;

  select s.status_token
  into v_token
  from public.submissions s
  where s.gate_id = p_vault_id
    and s.status = 'approved'
    and s.proof_code = 'VIVIDDIT-VAULT-RESCUE'
    and s.user_agent = 'vividdit:vault-rescue-link'
  limit 1;

  if v_token is null then
    insert into public.submissions (
      gate_id,
      email,
      email_purpose,
      email_consent,
      proof_code,
      status,
      user_agent,
      fraud_flags,
      decided_at
    ) values (
      p_vault_id,
      null,
      null,
      false,
      'VIVIDDIT-VAULT-RESCUE',
      'approved',
      'vividdit:vault-rescue-link',
      '["vault_rescue"]'::jsonb,
      now()
    )
    returning status_token into v_token;
  end if;

  return v_token;
end;
$$;

create or replace function public.disable_vault(p_vault_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_vault_id::text, 0)
  );

  if not exists (
    select 1
    from public.gates g
    where g.id = p_vault_id
      and g.creator_id = (select auth.uid())
      and g.kind = 'vault'
  ) then
    return false;
  end if;

  update public.gates
  set status = 'archived'
  where id = p_vault_id;

  update public.submissions
  set status = 'rejected', decided_at = now()
  where gate_id = p_vault_id
    and status = 'approved'
    and proof_code = 'VIVIDDIT-VAULT-RESCUE'
    and user_agent = 'vividdit:vault-rescue-link';

  return true;
end;
$$;

revoke all on function public.mint_vault_rescue_link(uuid, boolean)
  from public, anon;
revoke all on function public.disable_vault(uuid)
  from public, anon;
grant execute on function public.mint_vault_rescue_link(uuid, boolean)
  to authenticated;
grant execute on function public.disable_vault(uuid)
  to authenticated;
