-- Verification model override (advanced setting) and a display hint so the
-- settings UI can show which key is stored without touching the ciphertext.

alter table public.creator_ai_keys
  add column model text not null default 'gpt-5.4-mini',
  add column key_hint text;
