-- Table-level grants. This Supabase generation does not auto-grant API roles
-- access to new tables — RLS policies only filter rows once the role has the
-- table privilege, so each role gets exactly the verbs its policies allow.

grant usage on schema public to anon, authenticated, service_role;

-- service_role: full access (bypasses RLS, used by server-side code).
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- authenticated (creators — row filtering enforced by RLS policies):
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.gates to authenticated;
grant select, insert, update, delete on public.gate_requirements to authenticated;
grant select, insert, update, delete on public.download_assets to authenticated;
grant select, update on public.submissions to authenticated;
grant select on public.proof_images to authenticated;
grant select on public.verification_runs to authenticated;
grant select on public.events to authenticated;
-- creator_ai_keys and download_tokens: intentionally NO grants — service-role only.

-- anon (fan gate pages, SSR):
grant select on public.profiles to anon;
grant select on public.gates to anon;
grant select on public.gate_requirements to anon;
