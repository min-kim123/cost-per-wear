-- Daily snapshots of a user's total cost-per-wear, used to chart CPW trends
-- over time (1W / 1M / 3M / 1Y views) without reconstructing history client-side.

create table if not exists public.cpw_snapshots (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  date_key   text        not null,                     -- "YYYY-MM-DD"
  total_cpw  numeric     not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, date_key)
);

create index if not exists cpw_snapshots_user_date_idx on public.cpw_snapshots (user_id, date_key);

alter table public.cpw_snapshots enable row level security;

create policy "cpw_snapshots_select" on public.cpw_snapshots for select using (true);
create policy "cpw_snapshots_insert" on public.cpw_snapshots for insert with check (true);
create policy "cpw_snapshots_update" on public.cpw_snapshots for update using (true) with check (true);
create policy "cpw_snapshots_delete" on public.cpw_snapshots for delete using (true);
