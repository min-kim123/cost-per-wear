-- Background-removal queue for items added on platforms without on-device
-- subject lift (web, Android). Flagged rows are processed by an iOS device:
-- a silent push wakes the app, which runs the free Vision cutout, re-uploads
-- the image, and clears the flag. Anything the push misses is swept next time
-- the app opens.

alter table public.closet
  add column if not exists needs_bg_removal boolean not null default false;

create index if not exists closet_needs_bg_removal_idx
  on public.closet (user_id)
  where needs_bg_removal;

-- Expo push tokens for the user's devices, so the notify-bg-removal edge
-- function knows where to send the silent wake-up push.
create table if not exists public.push_tokens (
  token       text        primary key,               -- ExponentPushToken[...]
  user_id     uuid        references auth.users(id) on delete cascade,
  platform    text        not null default 'ios',
  updated_at  timestamptz not null default now()
);

create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Permissive policies (same pattern as the closet and outfits tables).
create policy "push_tokens_select" on public.push_tokens for select using (true);
create policy "push_tokens_insert" on public.push_tokens for insert with check (true);
create policy "push_tokens_update" on public.push_tokens for update using (true) with check (true);
create policy "push_tokens_delete" on public.push_tokens for delete using (true);
