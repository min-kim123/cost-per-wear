-- Lets a dated outfit (public.outfits) optionally carry the same board
-- layout shape as saved_outfits (canvas size + per-item x/y/scale/z), so an
-- outfit built with the outfit board can be redrawn with its saved
-- arrangement on the day page instead of a plain item grid. Null for
-- outfits logged without the board (photo-only or item-only).

alter table public.outfits
  add column if not exists board_canvas_w double precision,
  add column if not exists board_canvas_h double precision,
  add column if not exists board_items jsonb;
