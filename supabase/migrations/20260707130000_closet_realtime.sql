-- Broadcast closet changes over realtime so an open iOS app hears about
-- web-added items flagged needs_bg_removal immediately, instead of waiting
-- for a silent push or the next foreground sweep.

do $$
begin
  alter publication supabase_realtime add table public.closet;
exception
  when duplicate_object then null; -- already in the publication
end $$;
