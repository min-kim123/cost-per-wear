import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { DayTileOutfits } from "@/components/day-tile-outfits";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  type DayOutfit,
  getMonthGrid,
  getOutfitsMap,
} from "@/lib/outfit-storage";
import { getSupabase } from "@/supabase-client";

type Cell = {
  day: number | null;
  dateKey: string | null;
  outfits: DayOutfit[];
};

async function loadItemImageMap(): Promise<Record<string, string>> {
  const { data } = await getSupabase()
    .from("closet")
    .select("id, image");
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.image) map[row.id as string] = row.image as string;
  }
  return map;
}

export default function CalendarScreen() {
  const router = useRouter();
  const [outfitsByDay, setOutfitsByDay] = useState<Record<string, DayOutfit[]>>({});
  const [itemImageMap, setItemImageMap] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getOutfitsMap(), loadItemImageMap()]).then(([outfits, images]) => {
        if (active) {
          setOutfitsByDay(outfits);
          setItemImageMap(images);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const { year, monthIndex, cells } = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const grid = getMonthGrid(y, m);
    const list: Cell[] = grid.map((c) => ({
      ...c,
      outfits: c.dateKey ? outfitsByDay[c.dateKey] ?? [] : [],
    }));
    return { year: y, monthIndex: m, cells: list };
  }, [outfitsByDay]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          const { dx, dy } = gestureState;
          return Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const { dx, vx } = gestureState;
          if (dx < -50 && Math.abs(vx) > 0.2) {
            router.replace("/");
          }
        },
      }),
    [router],
  );

  const monthLabel = new Date(year, monthIndex, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <ThemedView style={styles.container} {...panResponder.panHandlers}>
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
        <FlatList
          data={cells}
          keyExtractor={(_, index) => `c-${index}`}
          numColumns={7}
          scrollEnabled={false}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            // Collect all item IDs worn that day across all outfits, deduplicated,
            // mapped to their closet image URLs (skip items without images).
            const imageUris = Array.from(
              new Set(item.outfits.flatMap((o) => o.itemIds)),
            )
              .map((id) => itemImageMap[id])
              .filter(Boolean) as string[];

            return (
              <View style={styles.dayCell}>
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
                    <Text style={styles.dayLabel}>{item.day}</Text>
                    <View style={styles.thumbnailWrapper}>
                      <DayTileOutfits imageUris={imageUris} />
                    </View>
                  </Pressable>
                ) : (
                  <View style={styles.emptyCell} />
                )}
              </View>
            );
          }}
        />
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
    marginHorizontal: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: GRID_LINE,
  },
  listContent: {
    paddingBottom: 24,
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 68,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: GRID_LINE,
  },
  dayCellPressable: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 2,
  },
  dayCellPressablePressed: {
    opacity: 0.65,
  },
  emptyCell: {
    flex: 1,
    minHeight: 56,
  },
  thumbnailWrapper: {
    width: 36,
    height: 36,
    overflow: "hidden",
    marginBottom: 4,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
});
