-- One-shot background-removal requests, so web can ask the user's iPhone to
-- cut out a photo the moment it's pasted — before the closet item is saved.
-- Web uploads the original, inserts a row, and polls result_url; the phone
-- (woken by silent push, realtime, or a foreground sweep) runs the on-device
-- cutout and writes result_url back. Rows are deleted by the requester once
-- consumed, and stale ones are cleaned up by the phone's sweep.

create table if not exists public.bg_removal_requests (
  id          text        primary key,                 -- e.g. "req-1735000000000-a1b2c3"
  user_id     uuid        references auth.users(id) on delete cascade,
  source_url  text        not null,
  result_url  text,
  created_at  timestamptz not null default now()
);

create index if not exists bg_removal_requests_pending_idx
  on public.bg_removal_requests (user_id)
  where result_url is null;

alter table public.bg_removal_requests enable row level security;

-- Permissive policies (same pattern as the closet and outfits tables).
create policy "bg_removal_requests_select" on public.bg_removal_requests for select using (true);
create policy "bg_removal_requests_insert" on public.bg_removal_requests for insert with check (true);
create policy "bg_removal_requests_update" on public.bg_removal_requests for update using (true) with check (true);
create policy "bg_removal_requests_delete" on public.bg_removal_requests for delete using (true);

-- Realtime so an open iOS app hears new requests instantly.
do $$
begin
  alter publication supabase_realtime add table public.bg_removal_requests;
exception
  when duplicate_object then null; -- already in the publication
end $$;
