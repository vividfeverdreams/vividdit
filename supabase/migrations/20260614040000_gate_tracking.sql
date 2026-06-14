-- Per-gate ad tracking pixels (client-side). These are PUBLIC identifiers
-- (they're served in the fan page's HTML), so they live on the gate row and
-- are anon-readable like the rest of a published gate. Shape:
--   { facebookPixelId, googleAdsTagId, googleConversionLabel, tiktokPixelId }
alter table public.gates
  add column tracking jsonb not null default '{}'::jsonb;