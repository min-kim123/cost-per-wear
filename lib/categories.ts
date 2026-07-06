import { getSupabase } from "@/supabase-client";

export type CategoryRow = {
  id: string;
  name: string;
  position: number;
};

const DEFAULT_CATEGORY_NAMES = [
  "top",
  "pants",
  "shoes",
  "jewelry",
  "hat",
  "accessory",
];

/** Special category: items in it accrue +1 wear per elapsed day (see creditDailyStackWears). */
export const DAILY_STACK_CATEGORY_NAME = "daily stack";

/** Insert the Daily Stack category (positioned before everything else) if the user doesn't have it yet. */
async function ensureDailyStackCategory(
  supabase: ReturnType<typeof getSupabase>,
  userId: string | undefined,
  existing: CategoryRow[],
): Promise<CategoryRow[]> {
  if (existing.some((c) => c.name === DAILY_STACK_CATEGORY_NAME)) return existing;

  const topPosition =
    existing.length > 0 ? Math.min(...existing.map((c) => c.position)) - 1 : 0;

  const { data, error } = await supabase
    .from("categories")
    .insert({ user_id: userId ?? null, name: DAILY_STACK_CATEGORY_NAME, position: topPosition })
    .select("id, name, position")
    .single();
  if (error) {
    // A concurrent call may have inserted it first — that's fine, just use what's there.
    if (error.code === "23505") return existing;
    throw new Error(error.message);
  }
  return [data as CategoryRow, ...existing].sort((a, b) => a.position - b.position);
}

/** Load this user's categories, lazily seeding the legacy defaults (and the Daily Stack category) on first use. */
export async function listCategories(): Promise<CategoryRow[]> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("categories")
    .select("id, name, position")
    .eq("user_id", user?.id ?? "")
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  if (data && data.length > 0) {
    return ensureDailyStackCategory(supabase, user?.id, data as CategoryRow[]);
  }

  const { data: seeded, error: seedError } = await supabase
    .from("categories")
    .insert(
      DEFAULT_CATEGORY_NAMES.map((name, position) => ({
        user_id: user?.id ?? null,
        name,
        position,
      })),
    )
    .select("id, name, position");
  if (seedError) throw new Error(seedError.message);
  return ensureDailyStackCategory(supabase, user?.id, (seeded ?? []) as CategoryRow[]);
}

/**
 * Credit +1 wear for every full day elapsed since an item was placed in the Daily Stack
 * category. Safe to call repeatedly (e.g. on every app open) — partial days are carried
 * forward in `daily_stack_since` rather than lost.
 */
export async function creditDailyStackWears(): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("closet")
    .select("id, wears, daily_stack_since")
    .eq("category", DAILY_STACK_CATEGORY_NAME)
    .not("daily_stack_since", "is", null);
  if (error || !data) return;

  const msPerDay = 24 * 60 * 60 * 1000;
  const now = Date.now();

  await Promise.all(
    data.map((row) => {
      const since = new Date(row.daily_stack_since as string).getTime();
      const daysElapsed = Math.floor((now - since) / msPerDay);
      if (!Number.isFinite(since) || daysElapsed <= 0) return null;

      const wears = Math.max(0, (row.wears as number) ?? 0) + daysElapsed;
      const daily_stack_since = new Date(since + daysElapsed * msPerDay).toISOString();
      return supabase.from("closet").update({ wears, daily_stack_since }).eq("id", row.id);
    }),
  );
}

export async function addCategory(name: string): Promise<CategoryRow> {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) throw new Error("Category name required");

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { count } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user?.id ?? "");

  const { data, error } = await supabase
    .from("categories")
    .insert({ user_id: user?.id ?? null, name: trimmed, position: count ?? 0 })
    .select("id, name, position")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("You already have a category with that name.");
    throw new Error(error.message);
  }
  return data as CategoryRow;
}

/** Delete a category and un-assign it from any closet items that used it. */
export async function deleteCategory(category: CategoryRow): Promise<void> {
  const supabase = getSupabase();

  await supabase.from("closet").update({ category: null }).eq("category", category.name);

  const { error } = await supabase.from("categories").delete().eq("id", category.id);
  if (error) throw new Error(error.message);
}

/** Persist a new drag-and-drop order. `orderedIds` must contain every category id, in the desired order. */
export async function reorderCategories(orderedIds: string[]): Promise<void> {
  const supabase = getSupabase();
  const results = await Promise.all(
    orderedIds.map((id, position) =>
      supabase.from("categories").update({ position }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

// ─── Shared grouping helpers (closet grid, outfit picker, …) ──────────────────

export type CategorySection<T> = {
  key: string;
  label: string;
  items: T[];
};

/** Group items by category, ordered to match the user's category list, with an "Uncategorized" tail. */
export function groupByCategory<T extends { category: string | null }>(
  items: T[],
  categories: CategoryRow[],
): CategorySection<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category ?? "uncategorized";
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(item);
    else byCategory.set(key, [item]);
  }
  const order = [...categories.map((c) => c.name), "uncategorized"];
  return order
    .filter((key) => byCategory.has(key))
    .map((key) => ({
      key,
      label: key === "uncategorized" ? "Uncategorized" : key.charAt(0).toUpperCase() + key.slice(1),
      items: byCategory.get(key)!,
    }));
}

/** Split a list into consecutive pairs, e.g. for a two-row horizontal-scroll section. */
export function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push(items.slice(i, i + 2));
  }
  return pairs;
}
