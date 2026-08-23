begin;

select plan(41);

insert into auth.users (id, created_at, updated_at)
values ('10000000-0000-4000-8000-000000000001', now(), now());

update public.profiles
set artist_name = 'Proof Batch Test', artist_slug = 'proof-batch-test'
where id = '10000000-0000-4000-8000-000000000001';

insert into public.gates (
  id,
  creator_id,
  title,
  artist,
  soundcloud_url,
  slug,
  status
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Proof Batch Gate',
  'Proof Batch Test',
  'https://soundcloud.com/example/track',
  'proof-batch-gate',
  'published'
);

insert into public.submissions (id, gate_id, proof_code, status_token, status)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'GATE-0001',
    '40000000-0000-4000-8000-000000000001',
    'pending'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'GATE-0002',
    '40000000-0000-4000-8000-000000000002',
    'pending'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    'GATE-0003',
    '40000000-0000-4000-8000-000000000003',
    'rejected'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    'GATE-0004',
    '40000000-0000-4000-8000-000000000004',
    'pending'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000001',
    'GATE-0005',
    '40000000-0000-4000-8000-000000000005',
    'pending'
  );

select ok(
  not has_table_privilege('anon', 'public.proof_upload_batches', 'select'),
  'anon cannot read proof upload batches'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.proof_upload_batches',
    'select'
  ),
  'authenticated creators cannot read proof upload batches'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.proof_upload_batches',
    'select,insert,update,delete'
  ),
  'service role owns proof upload batch lifecycle access'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.reserve_proof_upload_batch(uuid,uuid,uuid,text[])',
    'execute'
  ),
  'anon cannot call the reservation RPC'
);

select lives_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      array(
        select
          '20000000-0000-4000-8000-000000000001/' ||
          '30000000-0000-4000-8000-000000000001/uploads/' ||
          '50000000-0000-4000-8000-000000000001/' ||
          '60000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.png'
        from generate_series(1, 10) n
      )
    )
  $$,
  'a ten-proof batch reserves atomically'
);

select throws_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      array(
        select
          '20000000-0000-4000-8000-000000000001/' ||
          '30000000-0000-4000-8000-000000000001/uploads/' ||
          '50000000-0000-4000-8000-000000000002/' ||
          '61000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.png'
        from generate_series(1, 6) n
      )
    )
  $$,
  'P0001',
  'Too many screenshots on this submission.',
  'active reservations count toward the fifteen-proof cap'
);

select lives_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      array(
        select
          '20000000-0000-4000-8000-000000000001/' ||
          '30000000-0000-4000-8000-000000000001/uploads/' ||
          '50000000-0000-4000-8000-000000000003/' ||
          '62000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.png'
        from generate_series(1, 5) n
      )
    )
  $$,
  'the remaining five proof slots can be reserved'
);

select is(
  (
    select sum(cardinality(storage_paths))::integer
    from public.proof_upload_batches
    where submission_id = '30000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  15,
  'active reservation cardinality is persisted'
);

select lives_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000010',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      array[
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/uploads/50000000-0000-4000-8000-000000000010/60000000-0000-4000-8000-000000000010.png'
      ]
    )
  $$,
  'first parallel candidate batch reserves'
);
select lives_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000011',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      array[
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/uploads/50000000-0000-4000-8000-000000000011/60000000-0000-4000-8000-000000000011.png'
      ]
    )
  $$,
  'second parallel candidate batch reserves'
);

select results_eq(
  $$
    select proof_count, should_verify
    from public.complete_proof_upload_batch(
      '50000000-0000-4000-8000-000000000010',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      jsonb_build_array(jsonb_build_object(
        'storage_path', '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/uploads/50000000-0000-4000-8000-000000000010/60000000-0000-4000-8000-000000000010.png',
        'exact_hash', repeat('a', 64),
        'perceptual_hash', repeat('b', 16),
        'byte_size', 1024
      )),
      'soundcloud',
      null,
      false,
      true
    )
  $$,
  $$ values (1, true) $$,
  'atomic completion returns the verification claim'
);

select is(
  (select count(*)::integer from public.proof_images where submission_id = '30000000-0000-4000-8000-000000000002'),
  1,
  'atomic completion inserts the proof row'
);
select is(
  (select status from public.submissions where id = '30000000-0000-4000-8000-000000000002'),
  'verifying',
  'final completion claims the submission for verification'
);
select is(
  (select count(*)::integer from public.events where submission_id = '30000000-0000-4000-8000-000000000002' and event_type = 'submit'),
  1,
  'final completion inserts exactly one submit event'
);
select is(
  (select status from public.proof_upload_batches where id = '50000000-0000-4000-8000-000000000010'),
  'completed',
  'the winning batch is completed in the same transaction'
);
select ok(
  public.claim_submission_verification_dispatch(
    '30000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001'
  ),
  'the first verifier callback claims paid work'
);
select ok(
  public.claim_submission_verification_dispatch(
    '30000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001'
  ),
  'the winning token retries idempotently after response loss'
);
select ok(
  not public.claim_submission_verification_dispatch(
    '30000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002'
  ),
  'a different callback cannot overlap the active paid-work lease'
);

update public.submissions
set verification_dispatched_at = now() - interval '4 minutes'
where id = '30000000-0000-4000-8000-000000000002';

select ok(
  public.claim_submission_verification_dispatch(
    '30000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002'
  ),
  'a stale crashed worker lease is recoverable'
);
select is(
  (
    select verification_dispatch_token
    from public.submissions
    where id = '30000000-0000-4000-8000-000000000002'
  ),
  '70000000-0000-4000-8000-000000000002'::uuid,
  'lease recovery persists the new worker token'
);
select throws_ok(
  $$
    select *
    from public.complete_proof_upload_batch(
      '50000000-0000-4000-8000-000000000011',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      jsonb_build_array(jsonb_build_object(
        'storage_path', '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/uploads/50000000-0000-4000-8000-000000000011/60000000-0000-4000-8000-000000000011.png',
        'exact_hash', repeat('c', 64),
        'perceptual_hash', repeat('d', 16),
        'byte_size', 1024
      )),
      'soundcloud',
      null,
      false,
      true
    )
  $$,
  'P0001',
  'This submission is not accepting screenshots.',
  'a losing parallel completion cannot claim verification'
);
select is(
  (select count(*)::integer from public.events where submission_id = '30000000-0000-4000-8000-000000000002' and event_type = 'submit'),
  1,
  'a losing completion cannot add a second submit event'
);
select is(
  (
    select count(*)::integer
    from public.discard_proof_upload_batch(
      '50000000-0000-4000-8000-000000000010',
      '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002'
    )
  ),
  0,
  'discard cannot claim a completed batch'
);
select is(
  (select status from public.proof_upload_batches where id = '50000000-0000-4000-8000-000000000010'),
  'completed',
  'completed batch state survives a late discard'
);

insert into public.proof_images (
  submission_id,
  storage_path,
  exact_hash,
  perceptual_hash,
  byte_size,
  platform
) values
  (
    '30000000-0000-4000-8000-000000000003',
    'legacy/committed-one.png',
    repeat('e', 64),
    repeat('e', 16),
    10485760,
    'soundcloud'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'legacy/committed-two.png',
    repeat('f', 64),
    repeat('f', 16),
    10485760,
    'soundcloud'
  );

select lives_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000020',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000003',
      array[
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/uploads/50000000-0000-4000-8000-000000000020/60000000-0000-4000-8000-000000000020.png'
      ]
    )
  $$,
  'a resubmission can reserve by proof count before bytes are observed'
);
select throws_ok(
  $$
    select *
    from public.complete_proof_upload_batch(
      '50000000-0000-4000-8000-000000000020',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000003',
      jsonb_build_array(jsonb_build_object(
        'storage_path', '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/uploads/50000000-0000-4000-8000-000000000020/60000000-0000-4000-8000-000000000020.png',
        'exact_hash', repeat('1', 64),
        'perceptual_hash', repeat('1', 16),
        'byte_size', 6291456
      )),
      'soundcloud',
      null,
      false,
      true
    )
  $$,
  'P0001',
  'Screenshots must be 25MB or less in total.',
  'atomic completion enforces committed plus incoming actual bytes'
);
select is(
  (select count(*)::integer from public.proof_images where submission_id = '30000000-0000-4000-8000-000000000003'),
  2,
  'an over-byte-cap completion inserts no proof rows'
);
select is(
  (select status from public.proof_upload_batches where id = '50000000-0000-4000-8000-000000000020'),
  'active',
  'an over-byte-cap completion rolls back the batch transition'
);

select ok(
  public.claim_submission_verification(
    '30000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004'
  ),
  'legacy finalize atomically claims verification'
);
select ok(
  not public.claim_submission_verification(
    '30000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004'
  ),
  'a second legacy finalize cannot claim verification'
);
select is(
  (select status from public.submissions where id = '30000000-0000-4000-8000-000000000004'),
  'verifying',
  'legacy claim sets the same verifying state as completion'
);
select is(
  (select count(*)::integer from public.events where submission_id = '30000000-0000-4000-8000-000000000004' and event_type = 'submit'),
  1,
  'parallel legacy claims produce one submit event'
);

select lives_ok(
  $$
    select *
    from public.reserve_proof_upload_batch(
      '50000000-0000-4000-8000-000000000030',
      '30000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000005',
      array[
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000005/uploads/50000000-0000-4000-8000-000000000030/60000000-0000-4000-8000-000000000030.png'
      ]
    )
  $$,
  'cleanup test batch reserves'
);
select is(
  (
    select count(*)::integer
    from public.discard_proof_upload_batch(
      '50000000-0000-4000-8000-000000000030',
      '30000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000005'
    )
  ),
  1,
  'discard atomically returns only its owned path set'
);
select is(
  (select status from public.proof_upload_batches where id = '50000000-0000-4000-8000-000000000030'),
  'discarded',
  'discard transitions only an active batch'
);
select ok(
  not public.mark_proof_upload_batch_cleaned(
    '50000000-0000-4000-8000-000000000030'
  ),
  'discard cannot be marked finally cleaned while its signed URL is valid'
);

update public.proof_upload_batches
set expires_at = now() - interval '1 minute'
where id = '50000000-0000-4000-8000-000000000030';

select is(
  (
    select count(*)::integer
    from public.claim_expired_proof_upload_batches(200)
    where batch_id = '50000000-0000-4000-8000-000000000030'
  ),
  1,
  'cron claims discarded objects only after signed URL expiry'
);
select ok(
  public.mark_proof_upload_batch_cleaned(
    '50000000-0000-4000-8000-000000000030'
  ),
  'cron can acknowledge post-expiry object removal'
);
select ok(
  (select cleaned_at is not null from public.proof_upload_batches where id = '50000000-0000-4000-8000-000000000030'),
  'post-expiry cleanup acknowledgement is persisted'
);

select has_index(
  'public',
  'proof_images',
  'proof_images_submission_storage_path_unique',
  'proof storage paths have a database unique invariant'
);
select throws_ok(
  $$
    insert into public.proof_images (
      submission_id,
      storage_path,
      exact_hash,
      byte_size,
      platform
    ) values (
      '30000000-0000-4000-8000-000000000003',
      'legacy/committed-one.png',
      repeat('2', 64),
      1,
      'soundcloud'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "proof_images_submission_storage_path_unique"',
  'duplicate storage paths are rejected'
);

select * from finish();

rollback;
