-- Persist drag-and-drop ordering for closet items within their category.
-- Null means "not yet manually ordered"; those items sort first (newest first),
-- matching the previous created_at ordering for untouched closets.

alter table public.closet add column if not exists position integer;
