import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getWeatherMap, type WeatherMap } from "@/lib/weather";

import { DayTileOutfits } from "@/components/day-tile-outfits";
import { StaticOutfitBoard } from "@/components/outfit-board-static";
import { ThemedView } from "@/components/themed-view";
import {
  type DayOutfit,
  getMonthGrid,
  getOutfitsMap,
  getTodayDateKey,
} from "@/lib/outfit-storage";
import { getSupabase } from "@/lib/supabase-client";
import { useTabSwipeLock } from "@/lib/tab-swipe-lock";

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

const STRIP_RANGE = 24;
const CHIP_WIDTH = 64;
const CHIP_HEIGHT = 38;
const YEAR_LABEL_WIDTH = 52;
const YEAR_LABEL_HEIGHT = 30;
const CHIP_GAP = 4;

// On web the strip runs vertically down the left edge instead of across the top
const STRIP_VERTICAL = Platform.OS === "web";

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

function chipScrollOffset(offset: number, items: StripItem[]): number {
  const yearExtent = STRIP_VERTICAL ? YEAR_LABEL_HEIGHT : YEAR_LABEL_WIDTH;
  const chipExtent = STRIP_VERTICAL ? CHIP_HEIGHT : CHIP_WIDTH;
  let pos = 0;
  for (const item of items) {
    if (item.kind === "year") {
      pos += yearExtent + CHIP_GAP;
    } else {
      if (item.offset === offset) return pos;
      pos += chipExtent + CHIP_GAP;
    }
  }
  return pos;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const router = useRouter();
  const { setSwipeLocked } = useTabSwipeLock();
  const [outfitsByDay, setOutfitsByDay] = useState<Record<string, DayOutfit[]>>({});
  const [itemMetaMap, setItemMetaMap] = useState<Record<string, ItemMeta>>({});
  const [weatherMap, setWeatherMap] = useState<WeatherMap>({});
  const [monthOffset, setMonthOffset] = useState(0);

  const stripScrollRef = useRef<ScrollView>(null);
  const stripItems = useMemo(() => buildStrip(), []);
  const skipStripScrollRef = useRef(false);

  // Scroll strip to keep selected month centered whenever offset changes,
  // except when the change came from tapping a chip directly
  useEffect(() => {
    if (skipStripScrollRef.current) {
      skipStripScrollRef.current = false;
      return;
    }
    const pos = Math.max(0, chipScrollOffset(monthOffset, stripItems) - 140);
    stripScrollRef.current?.scrollTo(
      STRIP_VERTICAL ? { y: pos, animated: true } : { x: pos, animated: true },
    );
  }, [monthOffset, stripItems]);

  // One continuous sheet: every month in range is a page in a real paged
  // FlatList (same idea as the tab bar's pager), keyed by its absolute
  // offset from today. Once a page is mounted it stays mounted as you page
  // back and forth nearby, so its images decode once and never get torn
  // down and rebuilt — that teardown/rebuild on every swipe (not caching)
  // was what caused the white flash.
  const monthOffsets = useMemo(
    () => Array.from({ length: STRIP_RANGE * 2 + 1 }, (_, i) => i - STRIP_RANGE),
    [],
  );

  const [gridHeight, setGridHeight] = useState(0);
  const gridHeightRef = useRef(0);
  const gridListRef = useRef<FlatList<number>>(null);

  const handleGridLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    gridHeightRef.current = h;
    setGridHeight(h);
  }, []);

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const h = gridHeightRef.current;
      if (h <= 0) return;
      const idx = Math.round(e.nativeEvent.contentOffset.y / h);
      setMonthOffset(idx - STRIP_RANGE);
    },
    [],
  );

  // Lock the tab pager's horizontal swipe while a vertical page-drag is in
  // progress, so it can't steal the touch mid-gesture.
  const handleScrollBeginDrag = useCallback(() => setSwipeLocked(true), [setSwipeLocked]);
  const handleScrollEndDrag = useCallback(() => setSwipeLocked(false), [setSwipeLocked]);

  // Safety net: never leave the tab pager locked if this screen unmounts
  // mid-gesture.
  useEffect(() => () => setSwipeLocked(false), [setSwipeLocked]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getOutfitsMap(), loadItemMetaMap()]).then(([outfits, meta]) => {
        if (!active) return;
        setOutfitsByDay(outfits);
        setItemMetaMap(meta);

        // Warm the cache for every month up front so swiping never reveals
        // a panel whose images are still decoding — that per-image decode
        // latency is what shows up as a white flash cascading in day order.
        const uris = new Set<string>();
        for (const dayOutfits of Object.values(outfits)) {
          for (const o of dayOutfits) {
            if (o.photoUri) uris.add(o.photoUri);
          }
        }
        for (const m of Object.values(meta)) {
          if (m.image) uris.add(m.image);
        }
        if (uris.size > 0) {
          Image.prefetch(Array.from(uris)).catch(() => {});
        }
      });
      getWeatherMap().then((w) => { if (active) setWeatherMap(w); }).catch(() => {});
      return () => { active = false; };
    }, []),
  );

  const todayKey = getTodayDateKey();

  const monthGridFor = useCallback(
    (offset: number) => {
      const now = new Date();
      const raw = new Date(now.getFullYear(), now.getMonth() + offset, 1);
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
    },
    [outfitsByDay],
  );

  const { year, monthIndex } = useMemo(
    () => monthGridFor(monthOffset),
    [monthGridFor, monthOffset],
  );

  // renderItem reads outfitsByDay/itemMetaMap/weatherMap from closure, none
  // of which are in the FlatList's `data` array — without extraData,
  // already-mounted pages wouldn't re-render once the async fetches (which
  // resolve after first paint) come in.
  const gridExtraData = useMemo(
    () => [outfitsByDay, itemMetaMap, weatherMap] as const,
    [outfitsByDay, itemMetaMap, weatherMap],
  );

  // used for aria only
  void new Date(year, monthIndex, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  const renderGridRows = (rows: Cell[][]) => (
    <>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.gridRow}>
          {row.map((item, colIndex) => {
            const outfitPhotoUri =
              item.outfits.find((o) => o.photoUri)?.photoUri ?? null;
            const outfitBoard =
              item.outfits.find((o) => o.board)?.board ?? null;

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
            const hasCpw = item.outfits.length > 0;
            const isToday = item.dateKey === todayKey;
            const temp = item.dateKey != null ? weatherMap[item.dateKey] : undefined;

            // Keyed by date (not column position) so swiping months mounts a
            // fresh Image per day instead of swapping `source` on a reused
            // instance — the latter blanks to white for a frame even when
            // the photo is already cached.
            return (
              <View key={item.dateKey ?? `empty-${rowIndex}-${colIndex}`} style={styles.dayCell}>
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
                      ) : outfitBoard ? (
                        <StaticOutfitBoard
                          canvasW={outfitBoard.canvasW}
                          canvasH={outfitBoard.canvasH}
                          items={outfitBoard.items.map((bi) => ({
                            ...bi,
                            image: itemMetaMap[bi.id]?.image ?? null,
                          }))}
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
    </>
  );

  return (
    <ThemedView style={[styles.container, STRIP_VERTICAL && styles.containerRow]}>
      {/* Month strip */}
      <ScrollView
        ref={stripScrollRef}
        horizontal={!STRIP_VERTICAL}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.stripContent}
        style={[styles.strip, STRIP_VERTICAL && styles.stripVertical]}
      >
        {stripItems.map((item, i) => {
          if (item.kind === "year") {
            return (
              <View
                key={`y-${item.year}-${i}`}
                style={[styles.stripYearLabel, STRIP_VERTICAL && styles.stripYearLabelVertical]}
              >
                <Text style={styles.stripYearText}>{item.year}</Text>
              </View>
            );
          }
          const isSelected = item.offset === monthOffset;
          const isCurrentMonth = item.offset === 0;
          return (
            <Pressable
              key={item.offset}
              onPress={() => {
                skipStripScrollRef.current = true;
                setMonthOffset(item.offset);
                gridListRef.current?.scrollToIndex({
                  index: item.offset + STRIP_RANGE,
                  animated: true,
                });
              }}
              style={[styles.stripChip, isSelected && styles.stripChipSelected]}
              accessibilityRole="button"
              accessibilityLabel={`${item.label} ${item.year}`}
              accessibilityState={{ selected: isSelected }}
            >
              <Text
                style={[
                  styles.stripChipText,
                  isCurrentMonth && styles.stripChipTextCurrent,
                  isSelected && styles.stripChipTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.calendarArea}>
      {/* Weekday headers */}
      <View style={styles.weekdays}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={styles.gridFrame} onLayout={handleGridLayout}>
        {gridHeight > 0 ? (
          <FlatList
            ref={gridListRef}
            data={monthOffsets}
            keyExtractor={(offset) => String(offset)}
            renderItem={({ item: offset }) => (
              <View style={{ height: gridHeight }}>
                {renderGridRows(monthGridFor(offset).rows)}
              </View>
            )}
            getItemLayout={(_, index) => ({
              length: gridHeight,
              offset: gridHeight * index,
              index,
            })}
            extraData={gridExtraData}
            initialScrollIndex={STRIP_RANGE}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            windowSize={5}
            removeClippedSubviews={false}
          />
        ) : (
          renderGridRows(monthGridFor(monthOffset).rows)
        )}
      </View>
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
  containerRow: {
    flexDirection: "row",
  },
  calendarArea: {
    flex: 1,
  },
  // ── Month strip ────────────────────────────────────────────────────────────
  strip: {
    flexGrow: 0,
    flexShrink: 0,
  },
  stripVertical: {
    width: CHIP_WIDTH + 24,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: GRID_LINE,
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
  stripYearLabelVertical: {
    width: CHIP_WIDTH,
    height: YEAR_LABEL_HEIGHT,
    paddingVertical: 0,
  },
  stripYearText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
  },
  stripChip: {
    width: CHIP_WIDTH,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#bbb",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  stripChipSelected: {
    borderWidth: 1.5,
    borderColor: "#000",
  },
  stripChipText: {
    fontSize: 15,
    fontWeight: "400",
    color: "#555",
  },
  stripChipTextCurrent: {
    color: "#000",
    fontWeight: "700",
  },
  stripChipTextSelected: {
    color: "#000",
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
    overflow: "hidden",
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
