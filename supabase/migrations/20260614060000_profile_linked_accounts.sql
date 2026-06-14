-- Creators link their own Instagram/Spotify (SoundCloud already exists) at
-- onboarding so they can one-click add them to gates instead of re-typing.
alter table public.profiles
  add column instagram_url text,
  add column spotify_url text;