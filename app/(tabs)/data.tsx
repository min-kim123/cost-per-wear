import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getOutfitsMap } from "@/lib/outfit-storage";
import { getSupabase } from "@/supabase-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClosetItem = {
  id: string;
  cost: number;
  wears: number;
};

type ChartPoint = {
  label: string;
  cpw: number;
};

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadItems(): Promise<ClosetItem[]> {
  const { data } = await getSupabase().from("closet").select("id, cost, wears");
  return (data ?? []).map((row) => {
    const costRaw = row.cost;
    const cost =
      typeof costRaw === "string"
        ? parseFloat(costRaw)
        : typeof costRaw === "number"
          ? costRaw
          : 0;
    return {
      id: row.id as string,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
      wears: typeof row.wears === "number" && row.wears >= 0 ? row.wears : 0,
    };
  });
}

function computeTotalCPW(
  wearsMap: Record<string, number>,
  items: ClosetItem[],
): number {
  return items.reduce(
    (sum, item) => sum + item.cost / Math.max(wearsMap[item.id] ?? 1, 1),
    0,
  );
}

const MONTH_ABBR = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function toMonthLabel(dateKey: string): string {
  const [y, m] = dateKey.split("-");
  return `${MONTH_ABBR[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

async function buildChartPoints(items: ClosetItem[]): Promise<ChartPoint[]> {
  if (items.length === 0) return [];

  const outfitMap = await getOutfitsMap();
  const allDates = Object.keys(outfitMap).sort();
  if (allDates.length === 0) return [];

  // Start with current wears and work backwards through outfit history
  const wears: Record<string, number> = {};
  for (const item of items) wears[item.id] = item.wears;

  const rawPoints: { dateKey: string; cpw: number }[] = [];

  // Most-recent known CPW (end state)
  rawPoints.push({
    dateKey: allDates[allDates.length - 1],
    cpw: computeTotalCPW(wears, items),
  });

  // Walk backwards to reconstruct history
  for (const dateKey of [...allDates].reverse()) {
    for (const outfit of outfitMap[dateKey] ?? []) {
      for (const id of outfit.itemIds) {
        wears[id] = Math.max(0, (wears[id] ?? 0) - 1);
      }
    }
    rawPoints.unshift({ dateKey, cpw: computeTotalCPW(wears, items) });
  }

  // Collapse to one point per calendar month (last value wins)
  const byMonth = new Map<string, ChartPoint>();
  for (const pt of rawPoints) {
    const monthKey = pt.dateKey.slice(0, 7);
    byMonth.set(monthKey, { label: toMonthLabel(pt.dateKey), cpw: pt.cpw });
  }

  return Array.from(byMonth.values());
}

// ─── Line chart ───────────────────────────────────────────────────────────────

const CHART_HEIGHT = 160;
const PAD_LEFT = 52;
const PAD_TOP = 8;
const PAD_BOTTOM = 28; // room for x-axis labels
const DOT_R = 3.5;
const LINE_H = 2.5;

function LineChart({
  points,
  lineColor,
  gridColor,
  labelColor,
}: {
  points: ChartPoint[];
  lineColor: string;
  gridColor: string;
  labelColor: string;
}) {
  const [containerW, setContainerW] = useState(0);

  if (points.length < 2) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={[styles.chartEmptyText, { color: labelColor }]}>
          Log outfits to see your CPW trend over time
        </Text>
      </View>
    );
  }

  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const innerW = containerW - PAD_LEFT;

  const maxCPW = Math.max(...points.map((p) => p.cpw));
  const minCPW = Math.min(...points.map((p) => p.cpw));
  const range = maxCPW - minCPW || 1;

  const xOf = (i: number) =>
    PAD_LEFT + (i / (points.length - 1)) * innerW;
  const yOf = (cpw: number) =>
    PAD_TOP + (1 - (cpw - minCPW) / range) * innerH;

  // Y-axis ticks (4 levels)
  const yTicks = [0, 0.33, 0.67, 1].map((t) => ({
    value: minCPW + t * range,
    y: PAD_TOP + (1 - t) * innerH,
  }));

  // X-axis labels: at most 4, evenly spaced
  const stride = Math.max(1, Math.ceil(points.length / 4));
  const xLabelIdxs = new Set<number>([0, points.length - 1]);
  for (let i = 0; i < points.length; i += stride) xLabelIdxs.add(i);

  return (
    <View
      style={{ height: CHART_HEIGHT, width: "100%" }}
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
    >
      {containerW > 0 && (
        <View style={StyleSheet.absoluteFill}>
          {/* Grid lines + Y labels */}
          {yTicks.map((tick, i) => (
            <View key={i}>
              <Text
                style={[
                  styles.yLabel,
                  { top: tick.y - 8, color: labelColor },
                ]}
              >
                ${tick.value.toFixed(0)}
              </Text>
              <View
                style={[
                  styles.gridLine,
                  { top: tick.y, left: PAD_LEFT, width: innerW, backgroundColor: gridColor },
                ]}
              />
            </View>
          ))}

          {/* Line segments */}
          {points.slice(0, -1).map((pt, i) => {
            const x1 = xOf(i),   y1 = yOf(pt.cpw);
            const x2 = xOf(i+1), y2 = yOf(points[i + 1].cpw);
            const dx = x2 - x1,  dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            return (
              <View
                key={i}
                style={{
                  position: "absolute",
                  left: (x1 + x2) / 2 - len / 2,
                  top:  (y1 + y2) / 2 - LINE_H / 2,
                  width: len,
                  height: LINE_H,
                  borderRadius: LINE_H / 2,
                  backgroundColor: lineColor,
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}

          {/* Dots */}
          {points.map((pt, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                left: xOf(i) - DOT_R,
                top:  yOf(pt.cpw) - DOT_R,
                width:  DOT_R * 2,
                height: DOT_R * 2,
                borderRadius: DOT_R,
                backgroundColor: lineColor,
              }}
            />
          ))}

          {/* X-axis labels */}
          {[...xLabelIdxs].map((idx) => (
            <Text
              key={idx}
              style={[
                styles.xLabel,
                {
                  left: xOf(idx) - 22,
                  top: PAD_TOP + innerH + 6,
                  color: labelColor,
                },
              ]}
            >
              {points[idx].label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DataScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [items, setItems] = useState<ClosetItem[]>([]);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadItems();
      setItems(loaded);
      setChartPoints(await buildChartPoints(loaded));
    } catch {
      // swallow — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const currentTotalCPW = items.reduce(
    (sum, item) => sum + item.cost / Math.max(item.wears, 1),
    0,
  );
  const totalCost  = items.reduce((s, it) => s + it.cost, 0);
  const totalWears = items.reduce((s, it) => s + it.wears, 0);
  const avgCPW     = items.length > 0 ? currentTotalCPW / items.length : 0;

  const cardBg    = isDark ? "#222" : "#f5f5f5";
  const chartBg   = isDark ? "#1a1a1a" : "#f9f9f9";
  const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
  const labelColor = isDark ? "#888" : "#aaa";
  const textColor  = isDark ? "#fff" : "#111";

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText style={styles.pageTitle}>Data</ThemedText>

        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <>
            {/* ── Hero CPW card ─────────────────────────────────────── */}
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>Total Cost Per Wear</Text>
              <Text style={styles.heroAmount}>${currentTotalCPW.toFixed(2)}</Text>
              <Text style={styles.heroSub}>
                across {items.length} item{items.length !== 1 ? "s" : ""} in your closet
              </Text>
            </View>

            {/* ── Stat row ──────────────────────────────────────────── */}
            <View style={styles.statRow}>
              {[
                { value: `$${totalCost.toFixed(0)}`, label: "Total invested" },
                { value: String(totalWears), label: "Total wears" },
                { value: `$${avgCPW.toFixed(2)}`, label: "Avg per item" },
              ].map((s) => (
                <View key={s.label} style={[styles.statCard, { backgroundColor: cardBg }]}>
                  <Text style={[styles.statValue, { color: textColor }]}>{s.value}</Text>
                  <Text style={[styles.statLabel, { color: labelColor }]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* ── CPW over time chart ───────────────────────────────── */}
            <View style={[styles.chartCard, { backgroundColor: chartBg }]}>
              <ThemedText style={styles.chartTitle}>CPW Over Time</ThemedText>
              <Text style={[styles.chartDesc, { color: labelColor }]}>
                Total cost per wear as you log more outfits
              </Text>
              <LineChart
                points={chartPoints}
                lineColor={textColor}
                gridColor={gridColor}
                labelColor={labelColor}
              />
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 18,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 20,
  },
  loader: {
    marginTop: 60,
  },

  // Hero
  heroCard: {
    backgroundColor: "#111",
    borderRadius: 18,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: "center",
    marginBottom: 12,
  },
  heroEyebrow: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  heroAmount: {
    color: "#fff",
    fontSize: 52,
    fontWeight: "700",
    letterSpacing: -1.5,
    lineHeight: 56,
  },
  heroSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 6,
  },

  // Stat row
  statRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  statValue: {
    fontSize: 19,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 11,
    marginTop: 3,
    textAlign: "center",
  },

  // Chart
  chartCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  chartDesc: {
    fontSize: 12,
    marginBottom: 20,
  },
  chartEmpty: {
    height: CHART_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  chartEmptyText: {
    fontSize: 13,
    textAlign: "center",
    maxWidth: 220,
  },

  // Chart internals
  yLabel: {
    position: "absolute",
    left: 0,
    width: PAD_LEFT - 6,
    textAlign: "right",
    fontSize: 10,
  },
  gridLine: {
    position: "absolute",
    height: StyleSheet.hairlineWidth,
  },
  xLabel: {
    position: "absolute",
    width: 44,
    textAlign: "center",
    fontSize: 10,
  },
});
