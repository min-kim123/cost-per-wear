-- Daily Stack: a special category whose items accrue +1 wear per elapsed day
-- while assigned to it (see lib/categories.ts creditDailyStackWears).

alter table public.closet add column if not exists daily_stack_since timestamptz;
