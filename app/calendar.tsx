import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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

export default function CalendarScreen() {
  const router = useRouter();
  const [outfitsByDay, setOutfitsByDay] = useState<Record<string, DayOutfit[]>>({});
  const [itemMetaMap, setItemMetaMap] = useState<Record<string, ItemMeta>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getOutfitsMap(), loadItemMetaMap()]).then(([outfits, meta]) => {
        if (active) {
          setOutfitsByDay(outfits);
          setItemMetaMap(meta);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const todayKey = getTodayDateKey();

  const { year, monthIndex, rows } = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const grid = getMonthGrid(y, m);
    const list: Cell[] = grid.map((c) => ({
      ...c,
      outfits: c.dateKey ? outfitsByDay[c.dateKey] ?? [] : [],
    }));
    const chunks: Cell[][] = [];
    for (let i = 0; i < list.length; i += 7) chunks.push(list.slice(i, i + 7));
    return { year: y, monthIndex: m, rows: chunks };
  }, [outfitsByDay]);

  const monthLabel = new Date(year, monthIndex, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.monthHeader}>
        <ThemedText type="subtitle">{monthLabel}</ThemedText>
      </View>
      <View style={styles.weekdays}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.gridFrame}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.gridRow}>
            {row.map((item, colIndex) => {
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
                      <View style={isToday ? styles.todayCircle : undefined}>
                        <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                          {item.day}
                        </Text>
                      </View>
                      <View style={styles.thumbnailWrapper}>
                        <DayTileOutfits imageUris={imageUris} />
                      </View>
                      {hasCpw && (
                        <Text style={styles.cpwLabel}>
                          ${totalCpw.toFixed(2)}
                        </Text>
                      )}
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
const GRID_LINE = "#5C5C5C";

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  monthHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  weekdays: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 8,
    marginBottom: 0,
    borderBottomColor: GRID_LINE,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    opacity: 0.6,
    fontWeight: "600",
  },
  gridFrame: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: GRID_LINE,
  },
  gridRow: {
    flex: 1,
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: GRID_LINE,
    overflow: "hidden",
  },
  dayCellPressable: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 2,
    paddingBottom: 3,
  },
  dayCellPressablePressed: {
    opacity: 0.65,
  },
  emptyCell: {
    flex: 1,
  },
  thumbnailWrapper: {
    flex: 1,
    alignSelf: "stretch",
    overflow: "hidden",
    borderRadius: 6,
    marginBottom: 4,
    marginHorizontal: 3,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  todayCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ffb361",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  dayLabelToday: {
    color: "#fff",
  },
  cpwLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#ffb361",
    marginTop: 2,
    letterSpacing: 0.2,
  },
});
