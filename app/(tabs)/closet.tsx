import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import {
  ActivityIndicator,
  FlatList,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { getSupabase } from "@/supabase-client";

type ClothingItem = {
  id: string;
  brand: string;
  name: string;
  image: ImageSourcePropType;
  wears: number;
  cost: number;
};

type ClosetRow = {
  id: string;
  brand: string | null;
  name: string;
  cost: number | string | null;
  wears: number | null;
  image: string | null;
};

function mapClosetRowToItem(row: ClosetRow): ClothingItem {
  const costRaw = row.cost;
  const cost =
    typeof costRaw === "string"
      ? parseFloat(costRaw)
      : typeof costRaw === "number"
        ? costRaw
        : 0;
  const uri = row.image?.trim();
  const image: ImageSourcePropType = uri
    ? { uri }
    : (require("@/assets/images/image.png") as ImageSourcePropType);
  return {
    id: row.id,
    brand: row.brand ?? "",
    name: row.name,
    cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
    wears: typeof row.wears === "number" && row.wears >= 0 ? row.wears : 0,
    image,
  };
}

async function loadClosetFromSupabase(): Promise<ClothingItem[]> {
  const { data, error } = await getSupabase()
    .from("closet")
    .select("id, brand, name, cost, wears, image")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data as ClosetRow[] | null)?.map(mapClosetRowToItem) ?? [];
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function ClosetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [incrementing, setIncrementing] = useState(false);

  const loadItems = useCallback((opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setLoadError(null);
    return loadClosetFromSupabase()
      .then((list) => {
        setItems(list);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        setItems([]);
        setLoadError(e instanceof Error ? e.message : "Could not load closet");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#EFEFF4" }, "background");

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadItems({ silent: true });
  }, [loadItems]);

  function enterSelectMode() {
    setFabOpen(false);
    setSelectMode(true);
    setSelectedIds(new Set());
  }

  function cancelSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmIncrementWears() {
    if (selectedIds.size === 0) return;
    setIncrementing(true);
    try {
      const supabase = getSupabase();
      const ids = Array.from(selectedIds);
      const { data: rows } = await supabase
        .from("closet")
        .select("id, wears")
        .in("id", ids);
      for (const row of rows ?? []) {
        await supabase
          .from("closet")
          .update({ wears: ((row.wears as number) ?? 0) + 1 })
          .eq("id", row.id);
      }
      setSelectMode(false);
      setSelectedIds(new Set());
      loadItems({ silent: true });
    } finally {
      setIncrementing(false);
    }
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          const { dx, dy } = gestureState;
          return Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const { dx, vx } = gestureState;
          if (dx > 50 && Math.abs(vx) > 0.2) {
            router.replace("/");
          }
        },
      }),
    [router],
  );

  const { width: windowWidth } = useWindowDimensions();
  // 12px padding on each side + 4px margin on each side per card × 3 columns
  const cardWidth = (windowWidth - 24 - 24) / 3;

  const listBottomPad = Math.max(32, insets.bottom + 80);

  return (
    <ThemedView style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator style={styles.loading} size="large" />
        ) : (
          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.id}
            numColumns={3}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: listBottomPad },
            ]}
            ListHeaderComponent={
              <View style={styles.searchHeader}>
                <TextInput
                  accessibilityLabel="Search clothing by name or brand"
                  placeholder="Search name or brand"
                  placeholderTextColor={placeholderColor}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  style={[
                    styles.searchInput,
                    {
                      color: textColor,
                      borderColor,
                      backgroundColor: inputBackground,
                    },
                  ]}
                />
                {loadError ? (
                  <ThemedText style={styles.errorBanner}>{loadError}</ThemedText>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              loadError ? null : items.length > 0 ? (
                <ThemedText style={styles.emptySearch}>
                  No items match your search.
                </ThemedText>
              ) : (
                <ThemedText style={styles.emptySearch}>
                  No items in your closet yet.
                </ThemedText>
              )
            }
            renderItem={({ item }) => {
              const costPerWear = item.cost / Math.max(item.wears, 1);
              const isSelected = selectedIds.has(item.id);

              return (
                <Pressable
                  onPress={() =>
                    selectMode
                      ? toggleSelect(item.id)
                      : router.push(`/edit-closet-item?id=${item.id}`)
                  }
                  style={({ pressed }) => [
                    styles.cardPressable,
                    { width: cardWidth },
                    pressed && styles.cardPressed,
                    isSelected && styles.cardSelected,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={selectMode ? `Select ${item.name}` : `Edit ${item.name}`}
                >
                  <ThemedView style={styles.card}>
                    <Image
                      source={item.image}
                      style={styles.image}
                      contentFit="cover"
                    />
                    {isSelected && (
                      <View style={styles.selectedOverlay}>
                        <Ionicons name="checkmark-circle" size={28} color="#fff" />
                      </View>
                    )}
                    <ThemedView style={styles.cardContent}>
                      <ThemedText numberOfLines={1} style={styles.itemBrand}>
                        {[item.brand.trim(), formatCurrency(item.cost)]
                          .filter(Boolean)
                          .join(" | ")}
                      </ThemedText>
                      <ThemedText numberOfLines={2} style={styles.itemName}>
                        {item.name}
                      </ThemedText>
                      <ThemedText>{`${formatCurrency(costPerWear)}/wear (${item.wears})`}</ThemedText>
                    </ThemedView>
                  </ThemedView>
                </Pressable>
              );
            }}
          />
        )}
        {selectMode ? (
          <>
            <Pressable
              onPress={cancelSelectMode}
              style={[styles.fab, styles.fabCancel, { bottom: insets.bottom + 88, right: 16 }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
            <Pressable
              onPress={confirmIncrementWears}
              disabled={incrementing || selectedIds.size === 0}
              style={({ pressed }) => [
                styles.fab,
                { bottom: insets.bottom + 16, right: 16 },
                pressed && styles.fabPressed,
                (incrementing || selectedIds.size === 0) && styles.fabDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Confirm wear count"
            >
              {incrementing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.fabCountLabel} lightColor="#fff" darkColor="#fff">
                  +{selectedIds.size}
                </ThemedText>
              )}
            </Pressable>
          </>
        ) : fabOpen ? (
          <>
            <Pressable
              onPress={() => { setFabOpen(false); router.push("/add-closet-item"); }}
              style={[styles.fab, styles.fabSecondary, { bottom: insets.bottom + 88, right: 16 }]}
              accessibilityRole="button"
              accessibilityLabel="Add new item"
            >
              <Ionicons name="add" size={28} color="#fff" />
            </Pressable>
            <Pressable
              onPress={enterSelectMode}
              style={({ pressed }) => [
                styles.fab,
                { bottom: insets.bottom + 16, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Count wears"
            >
              <Ionicons name="shirt-outline" size={26} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setFabOpen(false)}
              style={styles.fabScrim}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            />
          </>
        ) : (
          <Pressable
            onPress={() => setFabOpen(true)}
            style={({ pressed }) => [
              styles.fab,
              { bottom: insets.bottom + 16, right: 16 },
              pressed && styles.fabPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Actions"
          >
            <Ionicons name="add" size={30} color="#fff" />
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    flexGrow: 1,
  },
  searchHeader: {
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  loading: {
    marginTop: 48,
  },
  errorBanner: {
    color: "#b91c1c",
    fontSize: 14,
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0a7ea4",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.88,
  },
  fabSecondary: {
    backgroundColor: "#444",
  },
  fabCancel: {
    backgroundColor: "#888",
  },
  fabDisabled: {
    opacity: 0.45,
  },
  fabCountLabel: {
    fontSize: 18,
    fontWeight: "700",
  },
  fabScrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  emptySearch: {
    textAlign: "center",
    marginTop: 24,
    opacity: 0.7,
  },
  cardPressable: {
    margin: 4,
  },
  cardPressed: {
    opacity: 0.75,
  },
  cardSelected: {
    opacity: 1,
    borderWidth: 2,
    borderColor: "#0a7ea4",
    borderRadius: 14,
  },
  selectedOverlay: {
    position: "absolute",
    top: 6,
    right: 6,
    zIndex: 2,
    backgroundColor: "rgba(10,126,164,0.75)",
    borderRadius: 14,
  },
  card: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  image: {
    width: "100%",
    aspectRatio: 3 / 4,
  },
  cardContent: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 2,
  },
  itemName: {},
  itemBrand: {
    fontSize: 11,
    opacity: 0.65,
    textAlign: "center",
  },
});
