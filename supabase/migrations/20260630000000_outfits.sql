-- Outfits table: stores daily outfit logs (date, items worn, optional photo URL).
-- Mirrors the shape previously stored in AsyncStorage (@cpw_outfits_v1).

create table if not exists public.outfits (
  id          text        primary key,                  -- e.g. "2026-06-30-1735000000000"
  user_id     uuid        references auth.users(id) on delete cascade,
  date_key    text        not null,                     -- "YYYY-MM-DD"
  photo_url   text,                                     -- Supabase Storage public URL, nullable
  item_ids    text[]      not null default '{}',        -- closet item UUIDs
  created_at  timestamptz not null default now()
);

create index if not exists outfits_user_date_idx on public.outfits (user_id, date_key);
create index if not exists outfits_date_key_idx  on public.outfits (date_key);

alter table public.outfits enable row level security;

-- Permissive policies (same pattern as the closet table).
create policy "outfits_select" on public.outfits for select using (true);
create policy "outfits_insert" on public.outfits for insert with check (true);
create policy "outfits_update" on public.outfits for update using (true) with check (true);
create policy "outfits_delete" on public.outfits for delete using (true);

-- ── Storage bucket for outfit photos ────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('outfit-photos', 'outfit-photos', true)
on conflict (id) do nothing;

create policy "outfit_photos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'outfit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "outfit_photos_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'outfit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "outfit_photos_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'outfit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "outfit_photos_select"
  on storage.objects for select
  to public
  using (bucket_id = 'outfit-photos');
