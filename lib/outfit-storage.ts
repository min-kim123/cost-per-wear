import * as FileSystem from "expo-file-system/legacy";

import { saveToCameraRoll } from "@/lib/save-to-camera-roll";
import { getSupabase } from "@/lib/supabase-client";
import { DAILY_STACK_CATEGORY_NAME } from "./categories";
import { deleteOutfitPhoto, uploadOutfitPhoto } from "./outfit-upload";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DayOutfitBoardItem = {
  id: string; // closet item id
  x: number;
  y: number;
  scale: number;
  z: number;
};

export type DayOutfitBoard = {
  canvasW: number;
  canvasH: number;
  items: DayOutfitBoardItem[];
};

export type DayOutfit = {
  id: string;
  photoUri: string;   // Supabase Storage public URL, or "" if no photo
  itemIds: string[];
  /** Saved outfit-board arrangement, when this outfit was built with the
   *  board instead of a plain item picker. Null otherwise. */
  board: DayOutfitBoard | null;
};

export type MonthCell = {
  day: number | null;
  dateKey: string | null;
};

// ─── Draft photo helpers (used by the home camera screen) ─────────────────────

function storageBaseDir(): string {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) throw new Error("No writable directory for outfit photos");
  return base;
}

function outfitsDir(): string {
  return `${storageBaseDir()}outfits/`;
}

export function getDraftPhotoUri(): string {
  return `${outfitsDir()}draft.jpg`;
}

export async function ensureOutfitsDirectory(): Promise<void> {
  await FileSystem.makeDirectoryAsync(outfitsDir(), { intermediates: true });
}

export async function copyUriToDraft(sourceUri: string): Promise<string> {
  await ensureOutfitsDirectory();
  const to = getDraftPhotoUri();
  await FileSystem.copyAsync({ from: sourceUri, to });
  return to;
}

export async function draftPhotoExists(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(getDraftPhotoUri());
    return info.exists;
  } catch {
    return false;
  }
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToOutfit(row: Record<string, unknown>): DayOutfit {
  const canvasW = row.board_canvas_w as number | null;
  const canvasH = row.board_canvas_h as number | null;
  const boardItems = row.board_items as DayOutfitBoardItem[] | null;
  return {
    id: row.id as string,
    photoUri: (row.photo_url as string | null) ?? "",
    itemIds: (row.item_ids as string[]) ?? [],
    board:
      canvasW && canvasH && boardItems && boardItems.length > 0
        ? { canvasW, canvasH, items: boardItems }
        : null,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Load all outfits for the current user, grouped by date key. */
export async function getOutfitsMap(): Promise<Record<string, DayOutfit[]>> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("outfits")
    .select("id, date_key, photo_url, item_ids, board_canvas_w, board_canvas_h, board_items")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: true });

  const map: Record<string, DayOutfit[]> = {};
  for (const row of data ?? []) {
    const dk = row.date_key as string;
    if (!map[dk]) map[dk] = [];
    map[dk].push(rowToOutfit(row as Record<string, unknown>));
  }
  return map;
}

/** Load outfits for a single date. */
export async function getOutfitsForDate(dateKey: string): Promise<DayOutfit[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("outfits")
    .select("id, date_key, photo_url, item_ids, board_canvas_w, board_canvas_h, board_items")
    .eq("user_id", user?.id ?? "")
    .eq("date_key", dateKey)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => rowToOutfit(row as Record<string, unknown>));
}

// ─── Wear counts ──────────────────────────────────────────────────────────────

/** Increment or decrement `closet.wears` for the given items (floored at 0). */
export async function adjustWears(ids: string[], delta: 1 | -1): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("closet")
    .select("id, wears")
    .in("id", ids);
  for (const row of rows ?? []) {
    const newWears = Math.max(0, ((row.wears as number) ?? 0) + delta);
    await supabase.from("closet").update({ wears: newWears }).eq("id", row.id);
  }
}

/**
 * Item ids that appear in any outfit on `dateKey`, optionally excluding one
 * outfit. Wears are capped at one per item per day: callers skip +1 for items
 * already in this set, and skip -1 for items still in it.
 */
export async function getWornItemIdsForDate(
  dateKey: string,
  excludeOutfitId?: string,
): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  let query = supabase
    .from("outfits")
    .select("id, item_ids")
    .eq("user_id", user?.id ?? "")
    .eq("date_key", dateKey);
  if (excludeOutfitId) query = query.neq("id", excludeOutfitId);
  const { data } = await query;

  const worn = new Set<string>();
  for (const row of data ?? []) {
    for (const id of (row.item_ids as string[]) ?? []) worn.add(id);
  }
  return worn;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Save an outfit with no photo, optionally carrying its board arrangement. */
export async function saveOutfitItemsOnly(
  itemIds: string[],
  dateKey?: string,
  board?: DayOutfitBoard | null,
): Promise<void> {
  const key = dateKey ?? getTodayDateKey();
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  await supabase.from("outfits").insert({
    id: `${key}-${Date.now()}`,
    user_id: user?.id ?? null,
    date_key: key,
    photo_url: null,
    item_ids: [...itemIds],
    board_canvas_w: board?.canvasW ?? null,
    board_canvas_h: board?.canvasH ?? null,
    board_items: board?.items ?? null,
  });
}

/** Save an outfit and upload its photo to Supabase Storage. */
export async function saveOutfitWithPhoto(
  itemIds: string[],
  localPhotoUri: string,
  dateKey?: string,
  opts?: { skipCameraRoll?: boolean },
): Promise<void> {
  const key = dateKey ?? getTodayDateKey();
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!opts?.skipCameraRoll) saveToCameraRoll(localPhotoUri);

  const photoUrl = await uploadOutfitPhoto(localPhotoUri, user?.id);

  await supabase.from("outfits").insert({
    id: `${key}-${Date.now()}`,
    user_id: user?.id ?? null,
    date_key: key,
    photo_url: photoUrl,
    item_ids: [...itemIds],
  });
}

/**
 * Legacy helper used by the home-screen camera flow.
 * Reads the draft photo, uploads it, then clears the local draft.
 */
export async function saveOutfitForToday(itemIds: string[]): Promise<void> {
  const draft = getDraftPhotoUri();
  const info = await FileSystem.getInfoAsync(draft);
  if (!info.exists) throw new Error("No draft photo. Take a picture first.");
  await saveOutfitWithPhoto(itemIds, draft, getTodayDateKey());
  await FileSystem.deleteAsync(draft, { idempotent: true });
}

// ─── Update ───────────────────────────────────────────────────────────────────

/** Edit an existing outfit's items and board arrangement (no photo involved). */
export async function updateOutfitBoard(
  outfitId: string,
  itemIds: string[],
  board: DayOutfitBoard,
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("outfits")
    .update({
      item_ids: [...itemIds],
      board_canvas_w: board.canvasW,
      board_canvas_h: board.canvasH,
      board_items: board.items,
    })
    .eq("id", outfitId);
}

/**
 * Edit an existing outfit's items and/or photo.
 * - `newPhotoUri === null`             → user cleared the photo
 * - `newPhotoUri === originalPhotoUri` → photo unchanged (both are the existing remote URL)
 * - `newPhotoUri !== originalPhotoUri` → user picked a new local photo
 */
export async function updateOutfit(
  _dateKey: string,
  outfitId: string,
  itemIds: string[],
  newPhotoUri: string | null,
  originalPhotoUri: string,
  opts?: { skipCameraRoll?: boolean },
): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  let finalPhotoUrl: string | null = originalPhotoUri || null;

  if (newPhotoUri === null) {
    // Photo cleared
    finalPhotoUrl = null;
    if (originalPhotoUri) {
      await deleteOutfitPhoto(originalPhotoUri).catch(() => {});
    }
  } else if (newPhotoUri !== originalPhotoUri) {
    // New local photo selected — upload it, then delete the old one
    if (!opts?.skipCameraRoll) saveToCameraRoll(newPhotoUri);
    finalPhotoUrl = await uploadOutfitPhoto(newPhotoUri, user?.id);
    if (originalPhotoUri) {
      await deleteOutfitPhoto(originalPhotoUri).catch(() => {});
    }
  }

  await supabase
    .from("outfits")
    .update({ item_ids: [...itemIds], photo_url: finalPhotoUrl })
    .eq("id", outfitId);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteOutfit(
  dateKey: string,
  outfitId: string,
): Promise<void> {
  const supabase = getSupabase();

  // Fetch the row before deleting so we can clean up storage and undo wears
  const { data } = await supabase
    .from("outfits")
    .select("photo_url, item_ids, date_key")
    .eq("id", outfitId)
    .single();

  await supabase.from("outfits").delete().eq("id", outfitId);

  // Undo the wear this outfit contributed. Skipped: Daily Stack items (they
  // accrue wears per-day via creditDailyStackWears, not per-outfit) and items
  // still in another outfit on the same day (max one wear per item per day).
  const itemIds = (data?.item_ids as string[] | null) ?? [];
  if (itemIds.length > 0) {
    const stillWorn = await getWornItemIdsForDate(
      (data?.date_key as string | null) ?? dateKey,
    );
    const { data: rows } = await supabase
      .from("closet")
      .select("id, wears, category")
      .in("id", itemIds);
    for (const row of rows ?? []) {
      if (row.category === DAILY_STACK_CATEGORY_NAME) continue;
      if (stillWorn.has(row.id as string)) continue;
      const newWears = Math.max(0, ((row.wears as number) ?? 0) - 1);
      await supabase.from("closet").update({ wears: newWears }).eq("id", row.id);
    }
  }

  if (data?.photo_url) {
    await deleteOutfitPhoto(data.photo_url as string).catch(() => {});
  }
}

// ─── One-time migration: AsyncStorage → Supabase ──────────────────────────────

const MIGRATION_DONE_KEY = "@cpw_outfits_migrated_v1";
const LEGACY_STORAGE_KEY = "@cpw_outfits_v1";

function normalizeLegacyMap(raw: Record<string, unknown>): Record<string, DayOutfit[]> {
  const out: Record<string, DayOutfit[]> = {};
  for (const [dateKey, val] of Object.entries(raw)) {
    if (val == null) continue;
    if (Array.isArray(val)) {
      out[dateKey] = val.map((e: unknown, i: number) => {
        const o = e as Partial<DayOutfit>;
        return {
          id: o.id ?? `${dateKey}-${i}-legacy`,
          photoUri: o.photoUri ?? "",
          itemIds: Array.isArray(o.itemIds) ? o.itemIds : [],
          board: null,
        };
      });
    } else if (typeof val === "object" && val !== null && "photoUri" in val) {
      const o = val as { photoUri: string; itemIds?: string[] };
      out[dateKey] = [{ id: `${dateKey}-0-legacy`, photoUri: o.photoUri, itemIds: o.itemIds ?? [], board: null }];
    }
  }
  return out;
}

/**
 * Run once per device: copy existing AsyncStorage outfit data into Supabase.
 * Call this after the user is confirmed to be logged in.
 * Photos that still exist as local files are uploaded; missing ones are skipped.
 */
export async function migrateLocalOutfitsToSupabase(): Promise<void> {
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;

  const done = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
  if (done === "1") return;

  const rawJson = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
  if (!rawJson) {
    await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
    return;
  }

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // not logged in — will retry next time

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
    return;
  }

  const legacy = normalizeLegacyMap(raw);
  const rows: {
    id: string;
    user_id: string;
    date_key: string;
    photo_url: string | null;
    item_ids: string[];
  }[] = [];

  for (const [dateKey, outfits] of Object.entries(legacy)) {
    for (const outfit of outfits) {
      let photoUrl: string | null = null;

      // Try to upload the local photo if it still exists on disk
      if (outfit.photoUri && !outfit.photoUri.startsWith("http")) {
        try {
          const info = await FileSystem.getInfoAsync(outfit.photoUri);
          if (info.exists) {
            photoUrl = await uploadOutfitPhoto(outfit.photoUri, user.id);
          }
        } catch {
          // Best-effort — skip photo if upload fails
        }
      } else if (outfit.photoUri.startsWith("http")) {
        photoUrl = outfit.photoUri; // already a remote URL
      }

      rows.push({
        id: outfit.id,
        user_id: user.id,
        date_key: dateKey,
        photo_url: photoUrl,
        item_ids: outfit.itemIds,
      });
    }
  }

  if (rows.length > 0) {
    await supabase
      .from("outfits")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  }

  await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function getTodayDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getMonthGrid(year: number, monthIndex: number): MonthCell[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < startPad; i++) cells.push({ day: null, dateKey: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, dateKey });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, dateKey: null });
  return cells;
}
