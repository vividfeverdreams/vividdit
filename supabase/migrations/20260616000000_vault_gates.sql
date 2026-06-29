-- "Complete Vault" gates: one special gate per creator that bundles the HQ
-- files from their other gates behind a single set of follow/email steps.
--
-- - kind: 'single' (a normal one-track gate) or 'vault' (the bundle).
-- - in_vault: for single gates, whether their download file is included in the
--   vault. Defaults true so new tracks auto-populate; creators can opt a track
--   out from the vault's customization page.

alter table public.gates
  add column kind text not null default 'single'
    check (kind in ('single', 'vault'));

alter table public.gates
  add column in_vault boolean not null default true;

-- At most one vault per creator.
create unique index gates_one_vault_per_creator
  on public.gates (creator_id)
  where kind = 'vault';
