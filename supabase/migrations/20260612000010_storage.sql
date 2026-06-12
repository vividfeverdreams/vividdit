-- Storage buckets and access policies.
--
-- covers:   public read; creators write inside their own uid folder.
-- hq-files: private; creators write inside their own uid folder; fans get
--           short-lived signed URLs minted server-side.
-- proofs:   private; uploads happen via server routes (service role);
--           creators can read proofs for their own gates.
--           Object paths: proofs/<gate_id>/<submission_id>/<file>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('covers', 'covers', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('hq-files', 'hq-files', false, 524288000, null),
  ('proofs', 'proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- covers: creators manage files under covers/<their uid>/...
create policy "covers_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "covers_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "covers_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- hq-files: creators manage files under hq-files/<their uid>/...
create policy "hq_files_select_own_folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'hq-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "hq_files_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'hq-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "hq_files_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'hq-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "hq_files_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'hq-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- proofs: creators read proofs attached to their own gates.
create policy "proofs_select_own_gates"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'proofs'
    and exists (
      select 1 from public.gates g
      where g.id::text = (storage.foldername(name))[1]
        and g.creator_id = (select auth.uid())
    )
  );
