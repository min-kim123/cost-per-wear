import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type Category } from "@/components/category-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { getSupabase } from "@/supabase-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClosetItem = {
  id: string;
  brand: string;
  name: string;
  image: ImageSourcePropType;
  wears: number;
  cost: number;
  category: Category | null;
};

type GroupInsight = {
  label: string;
  avgWears: number;
  itemCount: number;
};

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadClosetItems(): Promise<ClosetItem[]> {
  const { data, error } = await getSupabase()
    .from("closet")
    .select("id, brand, name, cost, wears, image, category")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const costRaw = row.cost;
    const cost =
      typeof costRaw === "string"
        ? parseFloat(costRaw)
        : typeof costRaw === "number"
          ? costRaw
          : 0;
    const uri = (row.image as string | null)?.trim();
    return {
      id: String(row.id),
      brand: (row.brand as string | null) ?? "",
      name: row.name as string,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
      wears: typeof row.wears === "number" && row.wears >= 0 ? row.wears : 0,
      image: uri
        ? { uri }
        : (require("@/assets/images/image.png") as ImageSourcePropType),
      category: (row.category as Category | null) ?? null,
    };
  });
}

// ─── Insight helpers ──────────────────────────────────────────────────────────

function topWornItems(items: ClosetItem[], limit: number): ClosetItem[] {
  return [...items]
    .filter((item) => item.wears > 0)
    .sort((a, b) => b.wears - a.wears)
    .slice(0, limit);
}

function topGroup(
  items: ClosetItem[],
  keyOf: (item: ClosetItem) => string | null,
): GroupInsight | null {
  const buckets = new Map<string, { totalWears: number; itemCount: number }>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { totalWears: 0, itemCount: 0 };
    bucket.totalWears += item.wears;
    bucket.itemCount += 1;
    buckets.set(key, bucket);
  }

  let best: GroupInsight | null = null;
  for (const [label, { totalWears, itemCount }] of buckets) {
    const avgWears = totalWears / itemCount;
    if (avgWears <= 0) continue;
    if (!best || avgWears > best.avgWears) {
      best = { label, avgWears, itemCount };
    }
  }
  return best;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ShoppingScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [loading, setLoading] = useState(true);

  const cardBackground = useThemeColor(
    { light: "#f5f5f5", dark: "#1c1c1e" },
    "background",
  );
  const labelColor = useThemeColor({ light: "#8E8E93" }, "icon");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await loadClosetItems());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const topItems = topWornItems(items, 5);
  const topCategory = topGroup(items, (item) => item.category);
  const topBrand = topGroup(items, (item) => item.brand.trim() || null);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title" style={styles.title}>
          Shopping
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: labelColor }]}>
          Recommendations based on what you actually wear
        </ThemedText>

        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : items.length === 0 ? (
          <ThemedText style={[styles.empty, { color: labelColor }]}>
            Log some outfits first — recommendations show up once we know what
            you actually wear.
          </ThemedText>
        ) : (
          <>
            {topItems.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>
                  Your most-worn items
                </ThemedText>
                {topItems.map((item) => (
                  <View
                    key={item.id}
                    style={[styles.itemCard, { backgroundColor: cardBackground }]}
                  >
                    <Image
                      source={item.image}
                      style={styles.itemImage}
                      contentFit="contain"
                    />
                    <View style={styles.itemInfo}>
                      <ThemedText numberOfLines={1} type="defaultSemiBold">
                        {item.name}
                      </ThemedText>
                      {item.brand.trim() ? (
                        <ThemedText
                          numberOfLines={1}
                          style={[styles.itemBrand, { color: labelColor }]}
                        >
                          {item.brand}
                        </ThemedText>
                      ) : null}
                      <ThemedText style={[styles.itemReason, { color: labelColor }]}>
                        Worn {item.wears} time{item.wears !== 1 ? "s" : ""} at{" "}
                        {formatCurrency(item.cost / Math.max(item.wears, 1))}
                        /wear — clearly a favorite.
                      </ThemedText>
                    </View>
                    <ComingSoonPill labelColor={labelColor} />
                  </View>
                ))}
              </View>
            )}

            {topCategory && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>
                  Your favorite category
                </ThemedText>
                <View style={[styles.insightCard, { backgroundColor: cardBackground }]}>
                  <Ionicons name="shirt-outline" size={22} color={labelColor} />
                  <View style={styles.insightInfo}>
                    <ThemedText type="defaultSemiBold">
                      {topCategory.label.charAt(0).toUpperCase() +
                        topCategory.label.slice(1)}
                    </ThemedText>
                    <ThemedText style={[styles.itemReason, { color: labelColor }]}>
                      Averaging {topCategory.avgWears.toFixed(1)} wears across{" "}
                      {topCategory.itemCount} item
                      {topCategory.itemCount !== 1 ? "s" : ""} — your
                      go-to category.
                    </ThemedText>
                  </View>
                  <ComingSoonPill labelColor={labelColor} />
                </View>
              </View>
            )}

            {topBrand && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>
                  Your favorite brand
                </ThemedText>
                <View style={[styles.insightCard, { backgroundColor: cardBackground }]}>
                  <Ionicons name="pricetag-outline" size={22} color={labelColor} />
                  <View style={styles.insightInfo}>
                    <ThemedText type="defaultSemiBold">
                      {topBrand.label}
                    </ThemedText>
                    <ThemedText style={[styles.itemReason, { color: labelColor }]}>
                      Averaging {topBrand.avgWears.toFixed(1)} wears across{" "}
                      {topBrand.itemCount} item
                      {topBrand.itemCount !== 1 ? "s" : ""} — items from here
                      earn their keep.
                    </ThemedText>
                  </View>
                  <ComingSoonPill labelColor={labelColor} />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function ComingSoonPill({ labelColor }: { labelColor: string }) {
  return (
    <View style={[styles.pill, { borderColor: labelColor }]}>
      <ThemedText style={[styles.pillText, { color: labelColor }]}>
        Recommendations coming soon
      </ThemedText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  title: {
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 20,
  },
  loader: {
    marginTop: 60,
  },
  empty: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 48,
    lineHeight: 20,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 10,
    gap: 10,
    marginBottom: 8,
  },
  itemImage: {
    width: 52,
    height: 68,
    borderRadius: 8,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemBrand: {
    fontSize: 12,
  },
  itemReason: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  insightCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  insightInfo: {
    flex: 1,
    gap: 2,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 84,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
  },
});
