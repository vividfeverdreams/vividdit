-- Allow OpenRouter as an alternative verification provider alongside OpenAI.
-- Backward-compatible: the unique(creator_id, provider) constraint is kept, so
-- existing OpenAI key upserts still work. The app enforces one verification key
-- per creator by deleting any prior row before inserting a new one.

alter table public.creator_ai_keys
  drop constraint if exists creator_ai_keys_provider_check;

alter table public.creator_ai_keys
  add constraint creator_ai_keys_provider_check
  check (provider in ('openai', 'openrouter'));
