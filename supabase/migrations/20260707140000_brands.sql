-- User-added brand names (beyond the hardcoded default list in lib/brands.ts),
-- previously stored in local AsyncStorage and not synced across devices.

create table if not exists public.brands (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists brands_user_id_idx on public.brands (user_id);

alter table public.brands enable row level security;

-- Permissive policies (same pattern as categories/closet/outfits).
create policy "brands_select" on public.brands for select using (true);
create policy "brands_insert" on public.brands for insert with check (true);
create policy "brands_delete" on public.brands for delete using (true);
