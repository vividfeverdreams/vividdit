-- Security-advisor fixes: pin function search_path, and make trigger
-- functions non-callable through the REST RPC surface.

alter function public.set_updated_at() set search_path = public;
alter function public.prevent_artist_slug_change() set search_path = public;
alter function public.enforce_gate_publish_rules() set search_path = public;
alter function public.handle_new_user() set search_path = public;

revoke execute on function public.set_updated_at() from anon, authenticated, public;
revoke execute on function public.prevent_artist_slug_change() from anon, authenticated, public;
revoke execute on function public.enforce_gate_publish_rules() from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;