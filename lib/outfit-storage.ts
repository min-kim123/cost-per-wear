import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

const KEY_OUTFITS = "@cpw_outfits_v1";

export type DayOutfit = {
  id: string;
  photoUri: string;
  itemIds: string[];
};

export type MonthCell = {
  day: number | null;
  dateKey: string | null;
};

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

function normalizeOutfitsMap(raw: Record<string, unknown>): Record<string, DayOutfit[]> {
  const out: Record<string, DayOutfit[]> = {};
  for (const [dateKey, val] of Object.entries(raw)) {
    if (val == null) continue;
    if (Array.isArray(val)) {
      out[dateKey] = val.map((e: unknown, i: number) => {
        const o = e as Partial<DayOutfit>;
        return {
          id: o.id ?? `${dateKey}-${i}-${o.photoUri?.slice(-8) ?? i}`,
          photoUri: o.photoUri ?? "",
          itemIds: Array.isArray(o.itemIds) ? o.itemIds : [],
        };
      });
    } else if (typeof val === "object" && val !== null && "photoUri" in val) {
      const o = val as { photoUri: string; itemIds?: string[] };
      out[dateKey] = [{ id: `${dateKey}-legacy`, photoUri: o.photoUri, itemIds: o.itemIds ?? [] }];
    }
  }
  return out;
}

async function loadOutfitsRaw(): Promise<Record<string, unknown>> {
  const raw = await AsyncStorage.getItem(KEY_OUTFITS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadOutfits(): Promise<Record<string, DayOutfit[]>> {
  return normalizeOutfitsMap(await loadOutfitsRaw());
}

async function saveOutfits(map: Record<string, DayOutfit[]>): Promise<void> {
  await AsyncStorage.setItem(KEY_OUTFITS, JSON.stringify(map));
}

export async function getOutfitsMap(): Promise<Record<string, DayOutfit[]>> {
  return loadOutfits();
}

export async function getOutfitsForDate(dateKey: string): Promise<DayOutfit[]> {
  const map = await loadOutfits();
  return map[dateKey] ?? [];
}

export async function saveOutfitForToday(itemIds: string[]): Promise<void> {
  const dateKey = getTodayDateKey();
  await ensureOutfitsDirectory();
  const draft = getDraftPhotoUri();
  const draftInfo = await FileSystem.getInfoAsync(draft);
  if (!draftInfo.exists) throw new Error("No draft photo. Take a picture first.");
  const entryId = `${dateKey}-${Date.now()}`;
  const finalUri = `${outfitsDir()}${entryId}.jpg`;
  await FileSystem.copyAsync({ from: draft, to: finalUri });
  await FileSystem.deleteAsync(draft, { idempotent: true });
  const outfits = await loadOutfits();
  const list = outfits[dateKey] ?? [];
  outfits[dateKey] = [...list, { id: entryId, photoUri: finalUri, itemIds: [...itemIds] }];
  await saveOutfits(outfits);
}

export async function deleteOutfit(dateKey: string, outfitId: string): Promise<void> {
  const outfits = await loadOutfits();
  const list = outfits[dateKey] ?? [];
  const removed = list.find((o) => o.id === outfitId);
  if (!removed) throw new Error("Outfit not found");
  const next = list.filter((o) => o.id !== outfitId);
  if (next.length === 0) {
    delete outfits[dateKey];
  } else {
    outfits[dateKey] = next;
  }
  await saveOutfits(outfits);
  if (removed.photoUri) {
    try {
      const info = await FileSystem.getInfoAsync(removed.photoUri);
      if (info.exists) await FileSystem.deleteAsync(removed.photoUri, { idempotent: true });
    } catch {
      // ignore missing file
    }
  }
}

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
