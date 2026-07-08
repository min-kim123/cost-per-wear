import { getSupabase } from "@/lib/supabase-client";

export type SavedOutfitItem = {
  id: string; // closet item id
  x: number;
  y: number;
  scale: number;
  z: number;
};

export type SavedOutfit = {
  id: string;
  createdAt: number;
  canvasW: number;
  canvasH: number;
  items: SavedOutfitItem[];
};

type SavedOutfitRow = {
  id: string;
  canvas_w: number;
  canvas_h: number;
  items: SavedOutfitItem[] | null;
  created_at: string;
};

function rowToSavedOutfit(row: SavedOutfitRow): SavedOutfit {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    canvasW: row.canvas_w,
    canvasH: row.canvas_h,
    items: row.items ?? [],
  };
}

export async function listSavedOutfits(): Promise<SavedOutfit[]> {
  await migrateLocalSavedOutfits().catch(() => {});
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("saved_outfits")
    .select("id, canvas_w, canvas_h, items, created_at")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: false }); // newest first
  if (error) throw new Error(error.message);
  return ((data as SavedOutfitRow[] | null) ?? []).map(rowToSavedOutfit);
}

export async function addSavedOutfit(
  outfit: Omit<SavedOutfit, "id" | "createdAt">,
): Promise<SavedOutfit> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const id = `outfit-${Date.now()}`;
  const { error } = await supabase.from("saved_outfits").insert({
    id,
    user_id: user?.id ?? null,
    canvas_w: outfit.canvasW,
    canvas_h: outfit.canvasH,
    items: outfit.items,
  });
  if (error) throw new Error(error.message);
  return { id, createdAt: Date.now(), ...outfit };
}

export async function updateSavedOutfit(
  id: string,
  outfit: Omit<SavedOutfit, "id" | "createdAt">,
): Promise<void> {
  const { error } = await getSupabase()
    .from("saved_outfits")
    .update({
      canvas_w: outfit.canvasW,
      canvas_h: outfit.canvasH,
      items: outfit.items,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSavedOutfit(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("saved_outfits")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── One-time migration: AsyncStorage → Supabase ──────────────────────────────

const LEGACY_STORAGE_KEY = "@cpw_saved_outfits_v1";

/** Copy outfits saved locally (before sync existed) into Supabase, then
 *  clear the local copy. No-ops when there's no local data or no user. */
async function migrateLocalSavedOutfits(): Promise<void> {
  const AsyncStorage = (
    await import("@react-native-async-storage/async-storage")
  ).default;

  const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // not logged in — retry next time

  let parsed: SavedOutfit[] = [];
  try {
    const json = JSON.parse(raw) as unknown;
    if (Array.isArray(json)) parsed = json as SavedOutfit[];
  } catch {
    // corrupt local data — drop it
  }

  if (parsed.length > 0) {
    const rows = parsed.map((o) => ({
      id: o.id,
      user_id: user.id,
      canvas_w: o.canvasW,
      canvas_h: o.canvasH,
      items: o.items,
      created_at: new Date(o.createdAt || Date.now()).toISOString(),
    }));
    const { error } = await supabase
      .from("saved_outfits")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) return; // keep local copy, retry next time
  }

  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
}

/** Short creation date shown under saved-outfit previews, e.g. "Jul 7, 2026". */
export function formatBoardDate(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
