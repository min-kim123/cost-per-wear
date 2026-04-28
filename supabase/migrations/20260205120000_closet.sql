-- Table used by the app: `public.closet` (see add-closet-item + fetchClosetItemsFromSupabase).
-- Create Storage bucket `closet-images` in the dashboard (public read, or signed URLs).

create table if not exists public.closet (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  name text not null,
  cost numeric not null default 0,
  wears integer not null default 0,
  image text,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists closet_created_at_idx on public.closet (created_at desc);
create index if not exists closet_user_id_idx on public.closet (user_id);

alter table public.closet enable row level security;

drop policy if exists "closet_select_anon" on public.closet;
drop policy if exists "closet_insert_anon" on public.closet;
drop policy if exists "closet_update_anon" on public.closet;
drop policy if exists "closet_delete_anon" on public.closet;

create policy "closet_select_anon" on public.closet for select using (true);
create policy "closet_insert_anon" on public.closet for insert with check (true);
create policy "closet_update_anon" on public.closet for update using (true) with check (true);
create policy "closet_delete_anon" on public.closet for delete using (true);
