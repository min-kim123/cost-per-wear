import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { getSnapshots, upsertTodaySnapshot } from "@/lib/cpw-history";
import { getOutfitsMap, getTodayDateKey } from "@/lib/outfit-storage";
import { getSupabase } from "@/lib/supabase-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClosetItem = {
  id: string;
  cost: number;
  wears: number;
};

type DailyPoint = {
  dateKey: string;
  cpw: number;
};

type ChartPoint = {
  dateKey: string;
  label: string;
  cpw: number;
  /** True for the single leading placeholder point before real tracking
   * began — rendered as a flat dotted line, not counted as real data. */
  synthetic: boolean;
};

type RangeKey = "1W" | "1M" | "3M" | "1Y" | "ALL";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "1Y", label: "1Y" },
];

// "ALL" has no fixed window — it spans from the first log to today instead.
const RANGE_DAYS: Record<Exclude<RangeKey, "ALL">, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

// Above this many days, "ALL" switches from daily "M/D" labels to monthly
// ones — otherwise a multi-year history would cram illegible day labels.
const ALL_MONTHLY_LABEL_THRESHOLD_DAYS = 35;

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
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMonthLabel(dateKey: string): string {
  const [y, m] = dateKey.split("-");
  return `${MONTH_ABBR[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

function toDateObj(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/**
 * Build a dense, forward-filled daily CPW series covering from the first
 * ever recorded date to today. Estimated values are reconstructed from
 * outfit-log history; any day with a real recorded snapshot
 * (`cpw_snapshots`) uses that ground-truth value instead, and today always
 * uses the live, just-computed total.
 */
async function buildDenseSeries(items: ClosetItem[]): Promise<DailyPoint[]> {
  const todayKey = getTodayDateKey();

  const outfitMap = await getOutfitsMap();
  const allDates = Object.keys(outfitMap).sort();

  // Reconstruct an end-of-day CPW estimate for every date with outfit activity.
  const values = new Map<string, number>();
  if (allDates.length > 0 && items.length > 0) {
    const wears: Record<string, number> = {};
    for (const item of items) wears[item.id] = item.wears;
    for (const dateKey of [...allDates].reverse()) {
      values.set(dateKey, computeTotalCPW(wears, items));
      for (const outfit of outfitMap[dateKey] ?? []) {
        for (const id of outfit.itemIds) {
          wears[id] = Math.max(0, (wears[id] ?? 0) - 1);
        }
      }
    }
  }

  // Real recorded snapshots are ground truth — they win over estimates.
  const snapshots = await getSnapshots();
  for (const s of snapshots) values.set(s.dateKey, s.totalCpw);

  // Today always reflects the live total, computed just now.
  const liveWears: Record<string, number> = {};
  for (const item of items) liveWears[item.id] = item.wears;
  values.set(todayKey, computeTotalCPW(liveWears, items));

  if (values.size === 0) return [];

  const knownDates = Array.from(values.keys()).sort();
  const startKey = knownDates[0];

  const dense: DailyPoint[] = [];
  let lastValue: number | null = null;
  let cursor = toDateObj(startKey);
  const end = toDateObj(todayKey);
  while (cursor <= end) {
    const key = getTodayDateKey(cursor);
    if (values.has(key)) lastValue = values.get(key)!;
    if (lastValue !== null) dense.push({ dateKey: key, cpw: lastValue });
    cursor = addDays(cursor, 1);
  }
  return dense;
}

function labelFor(dateKey: string, range: RangeKey, useMonthly = false): string {
  if (range === "1W") return WEEKDAY_ABBR[toDateObj(dateKey).getDay()];
  if (range === "1Y" || useMonthly) return toMonthLabel(dateKey);
  const d = toDateObj(dateKey);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Slice the dense daily series down to the selected range, at full daily
 * resolution. If real tracking data doesn't cover the whole range, prepend
 * a single flat placeholder point at the range start — the chart renders
 * the gap between it and the first real point as a dotted line.
 * "ALL" has no fixed window: it always starts exactly at the first known
 * point, so there's never a placeholder to draw.
 */
function toRangePoints(dense: DailyPoint[], range: RangeKey): ChartPoint[] {
  if (dense.length === 0) return [];

  if (range === "ALL") {
    const spanDays =
      (toDateObj(dense[dense.length - 1].dateKey).getTime() -
        toDateObj(dense[0].dateKey).getTime()) /
      86400000;
    const useMonthly = spanDays > ALL_MONTHLY_LABEL_THRESHOLD_DAYS;
    return dense.map((p) => ({
      dateKey: p.dateKey,
      label: labelFor(p.dateKey, range, useMonthly),
      cpw: p.cpw,
      synthetic: false,
    }));
  }

  const rangeStartKey = getTodayDateKey(addDays(new Date(), -(RANGE_DAYS[range] - 1)));
  const inRange = dense.filter((p) => p.dateKey >= rangeStartKey);
  if (inRange.length === 0) return [];

  const points: ChartPoint[] = [];
  if (inRange[0].dateKey > rangeStartKey) {
    points.push({
      dateKey: rangeStartKey,
      label: labelFor(rangeStartKey, range),
      cpw: inRange[0].cpw,
      synthetic: true,
    });
  }
  for (const p of inRange) {
    points.push({
      dateKey: p.dateKey,
      label: labelFor(p.dateKey, range),
      cpw: p.cpw,
      synthetic: false,
    });
  }
  return points;
}

// ─── Line chart ───────────────────────────────────────────────────────────────

const CHART_HEIGHT = 160;
const PAD_LEFT = 52;
const PAD_TOP = 8;
const PAD_BOTTOM = 28; // room for x-axis labels
const DOT_R = 3.5;
const LINE_H = 2.5;
const DASH_LEN = 5;
const DASH_GAP = 4;
const MAX_DOTS = 60; // beyond this, individual dots get too dense to read

/** Break a line segment into evenly spaced dash rectangles for a dotted look. */
function dashSegments(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const ux = dx / (len || 1);
  const uy = dy / (len || 1);
  const dashes: { left: number; top: number; width: number }[] = [];
  for (let d = 0; d < len; d += DASH_LEN + DASH_GAP) {
    const dashLen = Math.min(DASH_LEN, len - d);
    const cx = x1 + ux * (d + dashLen / 2);
    const cy = y1 + uy * (d + dashLen / 2);
    dashes.push({ left: cx - dashLen / 2, top: cy - LINE_H / 2, width: dashLen });
  }
  return { dashes, angle };
}

function LineChart({
  points,
  lineColor,
  gridColor,
  labelColor,
  maxLabels = 4,
}: {
  points: ChartPoint[];
  lineColor: string;
  gridColor: string;
  labelColor: string;
  maxLabels?: number;
}) {
  const [containerW, setContainerW] = useState(0);

  if (points.length < 2) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={[styles.chartEmptyText, { color: labelColor }]}>
          Check back tomorrow — your CPW is logged daily and needs a couple
          days to build a trend
        </Text>
      </View>
    );
  }

  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const innerW = containerW - PAD_LEFT;

  const maxCPW = Math.max(...points.map((p) => p.cpw));
  const minCPW = Math.min(...points.map((p) => p.cpw));
  const range = maxCPW - minCPW || 1;

  // Space points by real elapsed time, not by index — so a long dotted
  // "no data yet" gap actually looks long next to a run of daily points.
  const startTime = toDateObj(points[0].dateKey).getTime();
  const endTime = toDateObj(points[points.length - 1].dateKey).getTime();
  const totalSpan = Math.max(endTime - startTime, 1);
  const xOf = (i: number) =>
    PAD_LEFT +
    ((toDateObj(points[i].dateKey).getTime() - startTime) / totalSpan) * innerW;
  const yOf = (cpw: number) =>
    PAD_TOP + (1 - (cpw - minCPW) / range) * innerH;

  // Y-axis ticks (4 levels)
  const yTicks = [0, 0.33, 0.67, 1].map((t) => ({
    value: minCPW + t * range,
    y: PAD_TOP + (1 - t) * innerH,
  }));

  // X-axis labels: at most `maxLabels`, evenly spaced by real elapsed time
  // (points themselves may cluster near the end, e.g. a long dotted gap
  // followed by daily data, so index-based striding would bunch labels up).
  const labelCount = Math.min(maxLabels, points.length);
  const candidateIdxs = new Set<number>();
  for (let k = 0; k < labelCount; k++) {
    const t = startTime + (k / Math.max(labelCount - 1, 1)) * totalSpan;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(toDateObj(points[i].dateKey).getTime() - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    candidateIdxs.add(bestIdx);
  }
  candidateIdxs.add(0);
  candidateIdxs.add(points.length - 1);

  // A cluster of real points can sit in a tiny sliver of a long time range
  // (e.g. 10 days of data on a 1Y axis) — drop labels that would overlap.
  const MIN_LABEL_GAP = 36;
  const sortedCandidates = [...candidateIdxs].sort((a, b) => xOf(a) - xOf(b));
  const xLabelIdxs: number[] = [sortedCandidates[0]];
  for (let i = 1; i < sortedCandidates.length; i++) {
    const idx = sortedCandidates[i];
    const isLast = idx === points.length - 1;
    const gap = xOf(idx) - xOf(xLabelIdxs[xLabelIdxs.length - 1]);
    if (isLast && gap < MIN_LABEL_GAP && xLabelIdxs.length > 1) {
      xLabelIdxs.pop();
    } else if (!isLast && gap < MIN_LABEL_GAP) {
      continue;
    }
    xLabelIdxs.push(idx);
  }

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

          {/* Line segments — dotted grey while there's no real data yet,
              solid from the first real point onward */}
          {points.slice(0, -1).flatMap((pt, i) => {
            const x1 = xOf(i),   y1 = yOf(pt.cpw);
            const x2 = xOf(i+1), y2 = yOf(points[i + 1].cpw);

            if (pt.synthetic) {
              const { dashes, angle } = dashSegments(x1, y1, x2, y2);
              return dashes.map((d, j) => (
                <View
                  key={`${i}-${j}`}
                  style={{
                    position: "absolute",
                    left: d.left,
                    top: d.top,
                    width: d.width,
                    height: LINE_H,
                    borderRadius: LINE_H / 2,
                    backgroundColor: labelColor,
                    transform: [{ rotate: `${angle}deg` }],
                  }}
                />
              ));
            }

            const dx = x2 - x1,  dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            return [
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
              />,
            ];
          })}

          {/* Dots — only on real data points; suppressed when too dense */}
          {points.map((pt, i) => {
            if (pt.synthetic) return null;
            const isEndpoint = i === 0 || i === points.length - 1;
            if (points.length > MAX_DOTS && !isEndpoint) return null;
            return (
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
            );
          })}

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

  const [items, setItems] = useState<ClosetItem[]>([]);
  const [denseSeries, setDenseSeries] = useState<DailyPoint[]>([]);
  const [range, setRange] = useState<RangeKey>("1M");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadItems();
      setItems(loaded);
      setDenseSeries(await buildDenseSeries(loaded));

      // Log today's total CPW so tomorrow's chart has real ground truth,
      // not just a backward-reconstructed estimate. Best-effort.
      const liveTotalCPW = loaded.reduce(
        (sum, item) => sum + item.cost / Math.max(item.wears, 1),
        0,
      );
      upsertTodaySnapshot(liveTotalCPW, getTodayDateKey()).catch(() => {});
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

  const chartPoints = useMemo(
    () => toRangePoints(denseSeries, range),
    [denseSeries, range],
  );

  const currentTotalCPW = items.reduce(
    (sum, item) => sum + item.cost / Math.max(item.wears, 1),
    0,
  );
  const totalCost  = items.reduce((s, it) => s + it.cost, 0);
  const totalWears = items.reduce((s, it) => s + it.wears, 0);
  const avgCPW     = items.length > 0 ? currentTotalCPW / items.length : 0;

  const cardBg    = "#f5f5f5";
  const chartBg   = "#f9f9f9";
  const gridColor = "rgba(0,0,0,0.08)";
  const labelColor = "#aaa";
  const textColor  = "#111";

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: 20, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <>
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
                Total cost per wear, logged daily
              </Text>
              <LineChart
                points={chartPoints}
                lineColor={textColor}
                gridColor={gridColor}
                labelColor={labelColor}
                maxLabels={range === "1W" ? 7 : 4}
              />
              <View style={styles.rangeRow}>
                {RANGE_OPTIONS.map((opt) => {
                  const selected = opt.key === range;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setRange(opt.key)}
                      style={[
                        styles.rangeButton,
                        selected && {
                          backgroundColor: "rgba(0,0,0,0.08)",
                        },
                      ]}
                      hitSlop={4}
                    >
                      <Text
                        style={[
                          styles.rangeButtonText,
                          {
                            color: selected ? textColor : labelColor,
                            fontWeight: selected ? "700" : "500",
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={[styles.helperNote, { color: labelColor }]}>
              The lower the total cost per wear, the greater the value of your initial investment into your closet.
            </Text>
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
  loader: {
    marginTop: 60,
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

  helperNote: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 8,
  },

  // Range selector
  rangeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
  },
  rangeButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  rangeButtonText: {
    fontSize: 13,
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
