create extension if not exists dblink with schema extensions;

delete from auth.users
where id = '10000000-0000-4000-8000-000000000101';

insert into auth.users (id, created_at, updated_at)
values ('10000000-0000-4000-8000-000000000101', now(), now());

update public.profiles
set artist_name = 'Proof Concurrency Test', artist_slug = 'proof-concurrency-test'
where id = '10000000-0000-4000-8000-000000000101';

insert into public.gates (
  id,
  creator_id,
  title,
  artist,
  soundcloud_url,
  slug,
  status
) values (
  '20000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000101',
  'Proof Concurrency Gate',
  'Proof Concurrency Test',
  'https://soundcloud.com/example/concurrency',
  'proof-concurrency-gate',
  'published'
);

insert into public.submissions (id, gate_id, proof_code, status_token, status)
values
  (
    '30000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000101',
    'GATE-0101',
    '40000000-0000-4000-8000-000000000101',
    'pending'
  ),
  (
    '30000000-0000-4000-8000-000000000102',
    '20000000-0000-4000-8000-000000000101',
    'GATE-0102',
    '40000000-0000-4000-8000-000000000102',
    'pending'
  );

create or replace function public._proof_batch_test_try_reserve(
  p_batch_id uuid,
  p_submission_id uuid,
  p_status_token uuid,
  p_storage_paths text[]
)
returns text
language plpgsql
as $$
begin
  perform *
  from public.reserve_proof_upload_batch(
    p_batch_id,
    p_submission_id,
    p_status_token,
    p_storage_paths
  );
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

select plan(9);

select extensions.dblink_connect(
  'reserve_holder',
  format(
    'host=host.docker.internal port=54322 dbname=%s user=postgres password=postgres',
    current_database()
  )
);
select extensions.dblink_connect(
  'reserve_waiter',
  format(
    'host=host.docker.internal port=54322 dbname=%s user=postgres password=postgres',
    current_database()
  )
);

select extensions.dblink_exec('reserve_holder', 'begin');
select extensions.dblink_exec(
  'reserve_holder',
  'do $remote$ begin perform pg_advisory_xact_lock(pg_catalog.hashtextextended(''proof-upload:submission:30000000-0000-4000-8000-000000000101'', 0)); end $remote$;'
);

select extensions.dblink_send_query(
  'reserve_waiter',
  $$
    select public._proof_batch_test_try_reserve(
      '50000000-0000-4000-8000-000000000102',
      '30000000-0000-4000-8000-000000000101',
      '40000000-0000-4000-8000-000000000101',
      array(
        select
          '20000000-0000-4000-8000-000000000101/' ||
          '30000000-0000-4000-8000-000000000101/uploads/' ||
          '50000000-0000-4000-8000-000000000102/' ||
          '61000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.png'
        from generate_series(1, 10) n
      )
    )
  $$
);
select pg_sleep(0.25);

select is(
  extensions.dblink_is_busy('reserve_waiter'),
  1,
  'a concurrent reservation waits on the submission advisory lock'
);

select extensions.dblink_exec(
  'reserve_holder',
  $$
    do $remote$
    begin
      perform *
      from public.reserve_proof_upload_batch(
        '50000000-0000-4000-8000-000000000101',
        '30000000-0000-4000-8000-000000000101',
        '40000000-0000-4000-8000-000000000101',
        array(
          select
            '20000000-0000-4000-8000-000000000101/' ||
            '30000000-0000-4000-8000-000000000101/uploads/' ||
            '50000000-0000-4000-8000-000000000101/' ||
            '60000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.png'
          from generate_series(1, 10) n
        )
      );
    end
    $remote$;
  $$
);
select extensions.dblink_exec('reserve_holder', 'commit');

select is(
  (
    select result
    from extensions.dblink_get_result('reserve_waiter') as response(result text)
  ),
  'Too many screenshots on this submission.',
  'the serialized losing reservation observes committed capacity'
);
select is(
  (
    select sum(cardinality(storage_paths))::integer
    from public.proof_upload_batches
    where submission_id = '30000000-0000-4000-8000-000000000101'
      and status = 'active'
  ),
  10,
  'parallel reservations cannot overbook proof capacity'
);

-- dblink async connections require a fresh connection before starting a
-- second independent result set.
select extensions.dblink_disconnect('reserve_waiter');
select extensions.dblink_connect(
  'reserve_waiter',
  format(
    'host=host.docker.internal port=54322 dbname=%s user=postgres password=postgres',
    current_database()
  )
);

select *
from public.reserve_proof_upload_batch(
  '50000000-0000-4000-8000-000000000110',
  '30000000-0000-4000-8000-000000000102',
  '40000000-0000-4000-8000-000000000102',
  array[
    '20000000-0000-4000-8000-000000000101/30000000-0000-4000-8000-000000000102/uploads/50000000-0000-4000-8000-000000000110/60000000-0000-4000-8000-000000000110.png'
  ]
);

select extensions.dblink_exec('reserve_holder', 'begin');
select extensions.dblink_exec(
  'reserve_holder',
  'do $remote$ begin perform pg_advisory_xact_lock(pg_catalog.hashtextextended(''proof-upload:submission:30000000-0000-4000-8000-000000000102'', 0)); end $remote$;'
);
select extensions.dblink_send_query(
  'reserve_waiter',
  $$
    select count(*)::integer
    from public.discard_proof_upload_batch(
      '50000000-0000-4000-8000-000000000110',
      '30000000-0000-4000-8000-000000000102',
      '40000000-0000-4000-8000-000000000102'
    )
  $$
);
select pg_sleep(0.25);

select is(
  extensions.dblink_is_busy('reserve_waiter'),
  1,
  'discard waits while completion owns the submission transition lock'
);

select extensions.dblink_exec(
  'reserve_holder',
  $$
    do $remote$
    begin
      perform *
      from public.complete_proof_upload_batch(
        '50000000-0000-4000-8000-000000000110',
        '30000000-0000-4000-8000-000000000102',
        '40000000-0000-4000-8000-000000000102',
        jsonb_build_array(jsonb_build_object(
          'storage_path', '20000000-0000-4000-8000-000000000101/30000000-0000-4000-8000-000000000102/uploads/50000000-0000-4000-8000-000000000110/60000000-0000-4000-8000-000000000110.png',
          'exact_hash', repeat('9', 64),
          'perceptual_hash', repeat('9', 16),
          'byte_size', 2048
        )),
        'soundcloud',
        null,
        false,
        true
      );
    end
    $remote$;
  $$
);
select extensions.dblink_exec('reserve_holder', 'commit');

select is(
  (
    select result
    from extensions.dblink_get_result('reserve_waiter') as response(result integer)
  ),
  0,
  'a discard that loses the race cannot claim completed object paths'
);
select is(
  (select status from public.proof_upload_batches where id = '50000000-0000-4000-8000-000000000110'),
  'completed',
  'completion state wins atomically over the racing discard'
);
select is(
  (select count(*)::integer from public.proof_images where submission_id = '30000000-0000-4000-8000-000000000102'),
  1,
  'the winning completion keeps its proof row'
);
select is(
  (select count(*)::integer from public.events where submission_id = '30000000-0000-4000-8000-000000000102' and event_type = 'submit'),
  1,
  'the winning completion creates one submit event'
);
select is(
  (select status from public.submissions where id = '30000000-0000-4000-8000-000000000102'),
  'verifying',
  'the winning completion claims verification once'
);

select extensions.dblink_disconnect('reserve_holder');
select extensions.dblink_disconnect('reserve_waiter');

select * from finish();

drop function public._proof_batch_test_try_reserve(uuid, uuid, uuid, text[]);
delete from auth.users
where id = '10000000-0000-4000-8000-000000000101';
