import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getWeatherMap, type WeatherMap } from "@/lib/weather";

import { DayTileOutfits } from "@/components/day-tile-outfits";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  type DayOutfit,
  getMonthGrid,
  getOutfitsMap,
  getTodayDateKey,
} from "@/lib/outfit-storage";
import { getSupabase } from "@/supabase-client";

type Cell = {
  day: number | null;
  dateKey: string | null;
  outfits: DayOutfit[];
};

type ItemMeta = { image: string | null; cost: number; wears: number };

async function loadItemMetaMap(): Promise<Record<string, ItemMeta>> {
  const { data } = await getSupabase()
    .from("closet")
    .select("id, image, cost, wears");
  const map: Record<string, ItemMeta> = {};
  for (const row of data ?? []) {
    const costRaw = row.cost as number | string | null;
    const cost =
      typeof costRaw === "string"
        ? parseFloat(costRaw)
        : typeof costRaw === "number"
          ? costRaw
          : 0;
    map[row.id as string] = {
      image: (row.image as string | null) ?? null,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
      wears: typeof row.wears === "number" && row.wears >= 0 ? row.wears : 0,
    };
  }
  return map;
}

function outfitCostPerWear(
  itemIds: string[],
  metaMap: Record<string, ItemMeta>,
): number {
  return itemIds.reduce((sum, id) => {
    const meta = metaMap[id];
    if (!meta) return sum;
    return sum + meta.cost / Math.max(meta.wears, 1);
  }, 0);
}

// ── Month strip ────────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 50;
const STRIP_RANGE = 24;
const CHIP_WIDTH = 64;
const YEAR_LABEL_WIDTH = 52;
const CHIP_GAP = 4;

type StripItem =
  | { kind: "year"; year: number }
  | { kind: "month"; offset: number; year: number; label: string };

function buildStrip(): StripItem[] {
  const now = new Date();
  const items: StripItem[] = [];
  let lastYear: number | null = null;
  for (let o = -STRIP_RANGE; o <= STRIP_RANGE; o++) {
    const d = new Date(now.getFullYear(), now.getMonth() + o, 1);
    const y = d.getFullYear();
    if (y !== lastYear) {
      items.push({ kind: "year", year: y });
      lastYear = y;
    }
    items.push({
      kind: "month",
      offset: o,
      year: y,
      label: d.toLocaleString(undefined, { month: "short" }),
    });
  }
  return items;
}

function chipScrollX(offset: number, items: StripItem[]): number {
  let x = 0;
  for (const item of items) {
    if (item.kind === "year") {
      x += YEAR_LABEL_WIDTH + CHIP_GAP;
    } else {
      if (item.offset === offset) return x;
      x += CHIP_WIDTH + CHIP_GAP;
    }
  }
  return x;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const router = useRouter();
  const [outfitsByDay, setOutfitsByDay] = useState<Record<string, DayOutfit[]>>({});
  const [itemMetaMap, setItemMetaMap] = useState<Record<string, ItemMeta>>({});
  const [weatherMap, setWeatherMap] = useState<WeatherMap>({});
  const [monthOffset, setMonthOffset] = useState(0);

  const stripScrollRef = useRef<ScrollView>(null);
  const stripItems = useMemo(() => buildStrip(), []);

  // Scroll strip to keep selected month centered whenever offset changes
  useEffect(() => {
    const x = chipScrollX(monthOffset, stripItems) - 140;
    stripScrollRef.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [monthOffset, stripItems]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 10 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > SWIPE_THRESHOLD) {
          setMonthOffset((o) => o - 1); // swipe down → previous month
        } else if (gs.dy < -SWIPE_THRESHOLD) {
          setMonthOffset((o) => o + 1); // swipe up → next month
        }
      },
    }),
  ).current;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getOutfitsMap(), loadItemMetaMap()]).then(([outfits, meta]) => {
        if (active) {
          setOutfitsByDay(outfits);
          setItemMetaMap(meta);
        }
      });
      getWeatherMap().then((w) => { if (active) setWeatherMap(w); }).catch(() => {});
      return () => { active = false; };
    }, []),
  );

  const todayKey = getTodayDateKey();

  const { year, monthIndex, rows } = useMemo(() => {
    const now = new Date();
    const raw = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const y = raw.getFullYear();
    const m = raw.getMonth();
    const grid = getMonthGrid(y, m);
    const list: Cell[] = grid.map((c) => ({
      ...c,
      outfits: c.dateKey ? outfitsByDay[c.dateKey] ?? [] : [],
    }));
    const chunks: Cell[][] = [];
    for (let i = 0; i < list.length; i += 7) chunks.push(list.slice(i, i + 7));
    return { year: y, monthIndex: m, rows: chunks };
  }, [outfitsByDay, monthOffset]);

  // used for aria only
  void new Date(year, monthIndex, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <ThemedView style={styles.container}>
      {/* Month strip */}
      <ScrollView
        ref={stripScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripContent}
        style={styles.strip}
      >
        {stripItems.map((item, i) => {
          if (item.kind === "year") {
            return (
              <View key={`y-${item.year}-${i}`} style={styles.stripYearLabel}>
                <Text style={styles.stripYearText}>{item.year}</Text>
              </View>
            );
          }
          const isSelected = item.offset === monthOffset;
          return (
            <Pressable
              key={item.offset}
              onPress={() => setMonthOffset(item.offset)}
              style={[styles.stripChip, isSelected && styles.stripChipSelected]}
              accessibilityRole="button"
              accessibilityLabel={`${item.label} ${item.year}`}
              accessibilityState={{ selected: isSelected }}
            >
              <Text style={[styles.stripChipText, isSelected && styles.stripChipTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Weekday headers */}
      <View style={styles.weekdays}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {/* Calendar grid */}
      <View
        style={styles.gridFrame}
        {...panResponder.panHandlers}
      >
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.gridRow}>
            {row.map((item, colIndex) => {
              const outfitPhotoUri =
                item.outfits.find((o) => o.photoUri)?.photoUri ?? null;

              const allItemIds = Array.from(
                new Set(item.outfits.flatMap((o) => o.itemIds)),
              );
              const imageUris = allItemIds
                .map((id) => itemMetaMap[id]?.image)
                .filter(Boolean) as string[];

              const totalCpw = item.outfits.reduce(
                (sum, o) => sum + outfitCostPerWear(o.itemIds, itemMetaMap),
                0,
              );
              const hasCpw = item.outfits.length > 0 && totalCpw > 0;
              const isToday = item.dateKey === todayKey;
              const temp = item.dateKey != null ? weatherMap[item.dateKey] : undefined;

              return (
                <View key={colIndex} style={styles.dayCell}>
                  {item.day != null ? (
                    <Pressable
                      onPress={() => {
                        if (item.dateKey) {
                          router.push(`/day-outfits/${item.dateKey}`);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.dayCellPressable,
                        pressed && styles.dayCellPressablePressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={
                        item.dateKey
                          ? `Outfits for ${item.dateKey}`
                          : `Day ${item.day}`
                      }
                    >
                      {/* Day number centered at top */}
                      <View style={styles.cellTopRow}>
                        <View style={[styles.cellTopInner, isToday && styles.todayCircle]}>
                          <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                            {item.day}
                          </Text>
                        </View>
                      </View>

                      {/* Outfit thumbnail */}
                      <View style={styles.thumbnailWrapper}>
                        {outfitPhotoUri ? (
                          <Image
                            source={{ uri: outfitPhotoUri }}
                            style={styles.outfitPhoto}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                          />
                        ) : (
                          <DayTileOutfits imageUris={imageUris} />
                        )}
                      </View>

                      {/* Bottom row: temp left, cpw right */}
                      <View style={styles.cellBottomRow}>
                        <Text style={styles.tempLabel}>
                          {temp !== undefined ? `${temp}°` : ""}
                        </Text>
                        {hasCpw && (
                          <Text style={styles.cpwLabel}>
                            ${totalCpw.toFixed(2)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  ) : (
                    <View style={styles.emptyCell} />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ThemedView>
  );
}

/** Dark grey calendar grid lines */
const GRID_LINE = "rgba(128,128,128,0.35)";

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // ── Month strip ────────────────────────────────────────────────────────────
  strip: {
    flexGrow: 0,
    flexShrink: 0,
  },
  stripContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: CHIP_GAP,
    alignItems: "center",
  },
  stripYearLabel: {
    width: YEAR_LABEL_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  stripYearText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
  },
  stripChip: {
    width: CHIP_WIDTH,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  stripChipSelected: {
    backgroundColor: "#000",
  },
  stripChipText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#555",
  },
  stripChipTextSelected: {
    color: "#fff",
  },
  // ── Weekday header ─────────────────────────────────────────────────────────
  weekdays: {
    flexDirection: "row",
    paddingHorizontal: 0,
    paddingBottom: 8,
    borderBottomColor: GRID_LINE,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    opacity: 0.6,
    fontWeight: "600",
  },
  // ── Grid ───────────────────────────────────────────────────────────────────
  gridFrame: {
    flex: 1,
    marginHorizontal: 0,
    marginBottom: 0,
  },
  gridRow: {
    flex: 1,
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: GRID_LINE,
    overflow: "hidden",
  },
  dayCellPressable: {
    flex: 1,
    width: "100%",
    alignItems: "stretch",
    justifyContent: "flex-start",
    paddingTop: 2,
    paddingBottom: 3,
    paddingHorizontal: 2,
  },
  dayCellPressablePressed: {
    opacity: 0.65,
  },
  emptyCell: {
    flex: 1,
  },
  // ── Cell contents ──────────────────────────────────────────────────────────
  cellTopRow: {
    alignItems: "center",
    marginBottom: 2,
  },
  cellTopInner: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
    minHeight: 22,
  },
  thumbnailWrapper: {
    flex: 1,
    alignSelf: "stretch",
    overflow: "hidden",
    borderRadius: 6,
    marginHorizontal: 3,
  },
  outfitPhoto: {
    width: "100%",
    height: "100%",
  },
  cellBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginTop: 2,
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  todayCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  dayLabelToday: {
    color: "#fff",
  },
  cpwLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#000",
    letterSpacing: 0.2,
  },
  tempLabel: {
    fontSize: 9,
    color: "rgba(128,128,128,0.85)",
    letterSpacing: 0.1,
  },
});
