import * as FileSystem from "expo-file-system/legacy";

import { saveToCameraRoll } from "@/lib/save-to-camera-roll";
import { getSupabase } from "@/lib/supabase-client";
import { deleteOutfitPhoto, uploadOutfitPhoto } from "./outfit-upload";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DayOutfit = {
  id: string;
  photoUri: string;   // Supabase Storage public URL, or "" if no photo
  itemIds: string[];
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
  return {
    id: row.id as string,
    photoUri: (row.photo_url as string | null) ?? "",
    itemIds: (row.item_ids as string[]) ?? [],
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Load all outfits for the current user, grouped by date key. */
export async function getOutfitsMap(): Promise<Record<string, DayOutfit[]>> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("outfits")
    .select("id, date_key, photo_url, item_ids")
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
    .select("id, date_key, photo_url, item_ids")
    .eq("user_id", user?.id ?? "")
    .eq("date_key", dateKey)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => rowToOutfit(row as Record<string, unknown>));
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Save an outfit with no photo. */
export async function saveOutfitItemsOnly(
  itemIds: string[],
  dateKey?: string,
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
  });
}

/** Save an outfit and upload its photo to Supabase Storage. */
export async function saveOutfitWithPhoto(
  itemIds: string[],
  localPhotoUri: string,
  dateKey?: string,
): Promise<void> {
  const key = dateKey ?? getTodayDateKey();
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  saveToCameraRoll(localPhotoUri);

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
    saveToCameraRoll(newPhotoUri);
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
  _dateKey: string,
  outfitId: string,
): Promise<void> {
  const supabase = getSupabase();

  // Fetch the photo URL before deleting so we can clean up storage
  const { data } = await supabase
    .from("outfits")
    .select("photo_url")
    .eq("id", outfitId)
    .single();

  await supabase.from("outfits").delete().eq("id", outfitId);

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
        };
      });
    } else if (typeof val === "object" && val !== null && "photoUri" in val) {
      const o = val as { photoUri: string; itemIds?: string[] };
      out[dateKey] = [{ id: `${dateKey}-0-legacy`, photoUri: o.photoUri, itemIds: o.itemIds ?? [] }];
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
