-- Saved outfits: compositions built on the closet outfit board.
-- Each row stores the closet item ids with their board transforms
-- (position, pinch scale, stacking order) plus the canvas size, so the
-- collage can be re-rendered and scaled on any device.

create table if not exists public.saved_outfits (
  id          text        primary key,                  -- e.g. "outfit-1735000000000"
  user_id     uuid        references auth.users(id) on delete cascade,
  canvas_w    double precision not null,
  canvas_h    double precision not null,
  items       jsonb       not null default '[]',        -- [{id, x, y, scale, z}]
  created_at  timestamptz not null default now()
);

create index if not exists saved_outfits_user_idx
  on public.saved_outfits (user_id, created_at);

alter table public.saved_outfits enable row level security;

-- Permissive policies (same pattern as the closet and outfits tables).
create policy "saved_outfits_select" on public.saved_outfits for select using (true);
create policy "saved_outfits_insert" on public.saved_outfits for insert with check (true);
create policy "saved_outfits_update" on public.saved_outfits for update using (true) with check (true);
create policy "saved_outfits_delete" on public.saved_outfits for delete using (true);
