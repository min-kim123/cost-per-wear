-- Persist drag-and-drop ordering for categories.

alter table public.categories add column if not exists position integer;

update public.categories c
set position = sub.rn - 1
from (
  select id, row_number() over (partition by user_id order by created_at) as rn
  from public.categories
) sub
where c.id = sub.id
  and c.position is null;

alter table public.categories alter column position set not null;
alter table public.categories alter column position set default 0;
