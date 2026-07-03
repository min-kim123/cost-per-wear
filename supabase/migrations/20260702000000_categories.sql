-- User-defined clothing categories, replacing the previous fixed set
-- (top, pants, shoes, jewelry, hat, accessory). Those are lazily seeded
-- per-user on first read by lib/categories.ts.

create table if not exists public.categories (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists categories_user_id_idx on public.categories (user_id);

alter table public.categories enable row level security;

-- Permissive policies (same pattern as the closet/outfits tables).
create policy "categories_select" on public.categories for select using (true);
create policy "categories_insert" on public.categories for insert with check (true);
create policy "categories_update" on public.categories for update using (true) with check (true);
create policy "categories_delete" on public.categories for delete using (true);
