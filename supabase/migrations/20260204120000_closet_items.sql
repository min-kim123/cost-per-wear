-- Closet list for the app. Run in Supabase SQL editor or via CLI.
-- Tighten RLS policies when you add auth (e.g. restrict by auth.uid()).

create table if not exists public.closet_items (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  name text not null,
  cost numeric not null default 0,
  wears integer not null default 0,
  image_url text,
  created_at timestamptz not null default now()
);

create index if not exists closet_items_created_at_idx on public.closet_items (created_at desc);

alter table public.closet_items enable row level security;

-- Replace with user-scoped policies once Supabase Auth is wired up.
drop policy if exists "closet_items_select_anon" on public.closet_items;
drop policy if exists "closet_items_insert_anon" on public.closet_items;
drop policy if exists "closet_items_update_anon" on public.closet_items;
drop policy if exists "closet_items_delete_anon" on public.closet_items;

create policy "closet_items_select_anon"
  on public.closet_items for select
  using (true);

create policy "closet_items_insert_anon"
  on public.closet_items for insert
  with check (true);

create policy "closet_items_update_anon"
  on public.closet_items for update
  using (true)
  with check (true);

create policy "closet_items_delete_anon"
  on public.closet_items for delete
  using (true);
