-- Access to the tool is itself gated: a new creator must follow the Vividdit
-- creator on Instagram (verified by AI with the PLATFORM key) before they can
-- build gates. Null until they pass the onboarding follow gate.

alter table public.profiles
  add column access_unlocked_at timestamptz;