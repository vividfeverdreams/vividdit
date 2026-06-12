-- Per-gate toggle: ask fans to include a proof code in screenshots.
-- Codes are still generated internally (review UI references them); the
-- toggle controls whether fans see/are asked to use them.

alter table public.gate_requirements
  add column require_proof_code boolean not null default true;
