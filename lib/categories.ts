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

/** Load this user's categories, lazily seeding the legacy defaults on first use. */
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
  if (data && data.length > 0) return data as CategoryRow[];

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
  return (seeded ?? []) as CategoryRow[];
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
