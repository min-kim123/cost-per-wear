import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryFilterBar, type Category } from "@/components/category-picker";
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
  category: Category | null;
};

type ClosetRow = {
  id: string;
  brand: string | null;
  name: string;
  cost: number | string | null;
  wears: number | null;
  image: string | null;
  category: string | null;
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
    category: (row.category as Category | null) ?? null,
  };
}

async function loadClosetFromSupabase(): Promise<ClothingItem[]> {
  const { data, error } = await getSupabase()
    .from("closet")
    .select("id, brand, name, cost, wears, image, category")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data as ClosetRow[] | null)?.map(mapClosetRowToItem) ?? [];
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

type SortKey =
  | "cpw_asc"
  | "cpw_desc"
  | "cost_asc"
  | "cost_desc"
  | "wears_asc"
  | "wears_desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "cpw_asc", label: "Cost/wear: low → high" },
  { key: "cpw_desc", label: "Cost/wear: high → low" },
  { key: "cost_asc", label: "Cost: low → high" },
  { key: "cost_desc", label: "Cost: high → low" },
  { key: "wears_asc", label: "Wears: low → high" },
  { key: "wears_desc", label: "Wears: high → low" },
];

function sortItems(items: ClothingItem[], key: SortKey): ClothingItem[] {
  return [...items].sort((a, b) => {
    const cpwA = a.cost / Math.max(a.wears, 1);
    const cpwB = b.cost / Math.max(b.wears, 1);
    switch (key) {
      case "cpw_asc":
        return cpwA - cpwB;
      case "cpw_desc":
        return cpwB - cpwA;
      case "cost_asc":
        return a.cost - b.cost;
      case "cost_desc":
        return b.cost - a.cost;
      case "wears_asc":
        return a.wears - b.wears;
      case "wears_desc":
        return b.wears - a.wears;
    }
  });
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
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [incrementing, setIncrementing] = useState(false);
  const [hasGmailAccess, setHasGmailAccess] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);

  const checkGmailAccess = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("user_tokens")
      .select("user_id")
      .eq("provider", "google")
      .maybeSingle();
    setHasGmailAccess(data !== null);
  }, []);

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
  const inputBackground = useThemeColor({ light: "#F8F8F8" }, "background");
  const cardBackground = useThemeColor(
    { light: "#ffffff", dark: "#1c1c1e" },
    "background",
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q)
      );
    });
    return sortKey ? sortItems(filtered, sortKey) : filtered;
  }, [items, searchQuery, categoryFilter, sortKey]);

  useFocusEffect(
    useCallback(() => {
      loadItems({ silent: true });

      checkGmailAccess();
    }, [loadItems, checkGmailAccess]),
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

  async function syncGmail() {
    setFabOpen(false);
    setSyncing(true);
    try {
      await getSupabase().functions.invoke("sync-gmail", {
        body: { force: true },
      });
      loadItems({ silent: true });
    } finally {
      setSyncing(false);
    }
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

  const { width: windowWidth } = useWindowDimensions();
  // 12px padding on each side + 4px margin on each side per card × 3 columns
  const cardWidth = (windowWidth - 24 - 24) / 3;

  const listBottomPad = Math.max(32, insets.bottom + 80);

  return (
    <ThemedView style={styles.container}>
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
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            }
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: listBottomPad },
            ]}
            ListHeaderComponent={
              <View style={styles.searchHeader}>
                <View style={styles.searchRow}>
                  <View
                    style={[
                      styles.searchInputWrap,
                      { borderColor, backgroundColor: inputBackground },
                    ]}
                  >
                    <Ionicons
                      name="search"
                      size={16}
                      color={placeholderColor}
                      style={styles.searchIcon}
                    />
                    <TextInput
                      accessibilityLabel="Search clothing by name or brand"
                      placeholder="Search name or brand"
                      placeholderTextColor={placeholderColor}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                      clearButtonMode="while-editing"
                      style={[styles.searchInput, { color: textColor }]}
                    />
                  </View>
                  <Pressable
                    onPress={() => setShowSortSheet(true)}
                    style={({ pressed }) => [
                      styles.sortBtn,
                      { borderColor, backgroundColor: inputBackground },
                      sortKey && styles.sortBtnActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Sort"
                  >
                    <Ionicons
                      name="swap-vertical-outline"
                      size={18}
                      color={sortKey ? "#fff" : textColor}
                    />
                  </Pressable>
                </View>
                <CategoryFilterBar
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                />
                {loadError ? (
                  <ThemedText style={styles.errorBanner}>
                    {loadError}
                  </ThemedText>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              loadError ? null : items.length > 0 ? (
                <ThemedText style={styles.emptySearch}>
                  No items match your search.
                </ThemedText>
              ) : (
                <View style={styles.emptyState}>
                  <ThemedText style={styles.emptySearch}>
                    No items in your closet yet.
                  </ThemedText>
                  {hasGmailAccess === false && (
                    <Pressable
                      onPress={() => router.push("/connect-gmail")}
                      style={({ pressed }) => [
                        styles.gmailPrompt,
                        pressed && styles.fabPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Connect Gmail to import purchases"
                    >
                      <ThemedText style={styles.gmailPromptText}>
                        Connect Gmail to auto-import purchases
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
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
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectMode ? `Select ${item.name}` : `Edit ${item.name}`
                  }
                >
                  <ThemedView style={styles.card}>
                    <View style={styles.imageContainer}>
                      <Image
                        source={item.image}
                        style={styles.image}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                      <View style={styles.cpwBadge} pointerEvents="none">
                        <ThemedText style={styles.cpwText}>
                          {formatCurrency(costPerWear)}
                        </ThemedText>
                      </View>
                    </View>
                    {isSelected && (
                      <>
                        <View
                          style={styles.selectedBorder}
                          pointerEvents="none"
                        />
                        <View style={styles.selectedOverlay}>
                          <Ionicons
                            name="checkmark-circle"
                            size={28}
                            color="#fff"
                          />
                        </View>
                      </>
                    )}
                    <ThemedView style={styles.cardContent}>
                      <ThemedText numberOfLines={1} style={styles.itemBrand}>
                        {[item.brand.trim(), formatCurrency(item.cost)]
                          .filter(Boolean)
                          .join(" | ")}
                      </ThemedText>
                      <View style={styles.nameWrap}>
                        <LinearGradient
                          colors={[`${cardBackground}00`, cardBackground]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.nameFade}
                          pointerEvents="none"
                        />
                      </View>
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
              style={[
                styles.fab,
                styles.fabCancel,
                { bottom: insets.bottom + 88, right: 16 },
              ]}
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
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 16, right: 16 },
                pressed && styles.fabPressed,
                (incrementing || selectedIds.size === 0) && styles.fabDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Confirm wear count"
            >
              {incrementing ? (
                <ActivityIndicator color="#000" />
              ) : (
                <ThemedText style={styles.fabRectLabel}>done</ThemedText>
              )}
            </Pressable>
          </>
        ) : fabOpen ? (
          <>
            {hasGmailAccess && (
              <Pressable
                onPress={syncGmail}
                disabled={syncing}
                style={({ pressed }) => [
                  styles.fab,
                  styles.fabRect,
                  styles.fabRectOutline,
                  { bottom: insets.bottom + 232, right: 16 },
                  pressed && styles.fabPressed,
                  syncing && styles.fabDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Sync Gmail"
              >
                {syncing ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <ThemedText style={styles.fabRectLabel}>
                    sync gmail
                  </ThemedText>
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setFabOpen(false);
                router.push("/log-outfit");
              }}
              style={({ pressed }) => [
                styles.fab,
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 160, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Log today's outfit"
            >
              <ThemedText style={styles.fabRectLabel}>
                today's outfit
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                setFabOpen(false);
                router.push("/add-closet-item");
              }}
              style={[
                styles.fab,
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 88, right: 16 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="add items"
            >
              <ThemedText style={styles.fabRectLabel}>add item</ThemedText>
            </Pressable>
            <Pressable
              onPress={enterSelectMode}
              style={({ pressed }) => [
                styles.fab,
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 16, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Count wears"
            >
              <ThemedText style={styles.fabRectLabel}>+ wear count</ThemedText>
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

      <Modal
        visible={showSortSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSortSheet(false)}
      >
        <Pressable
          style={styles.sheetOverlay}
          onPress={() => setShowSortSheet(false)}
        >
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <ThemedText type="defaultSemiBold" style={styles.sheetTitle}>
              Sort by
            </ThemedText>
            {SORT_OPTIONS.map((opt) => {
              const active = sortKey === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setSortKey(active ? null : opt.key);
                    setShowSortSheet(false);
                  }}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    active && styles.sheetOptionActive,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <ThemedText
                    style={[
                      styles.sheetOptionText,
                      active && styles.sheetOptionTextActive,
                    ]}
                  >
                    {opt.label}
                  </ThemedText>
                  {active && (
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setShowSortSheet(false)}
              style={({ pressed }) => [
                styles.sheetCancel,
                pressed && { opacity: 0.7 },
              ]}
            >
              <ThemedText style={styles.sheetCancelText}>Cancel</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
  searchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  searchInputWrap: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 6,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  sortBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sortBtnActive: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingBottom: 36,
    paddingTop: 12,
    gap: 6,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 15,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  sheetOptionActive: {
    backgroundColor: "#000",
  },
  sheetOptionText: {
    fontSize: 15,
  },
  sheetOptionTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  sheetCancel: {
    marginTop: 6,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#f2f2f7",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancelText: {
    fontSize: 16,
    fontWeight: "600",
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
    width: 60,
    height: 60,
    borderRadius: 25,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
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
  fabRect: {
    width: "auto",
    paddingHorizontal: 20,
    borderRadius: 22,
  },
  fabRectOutline: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#000",
  },
  fabRectLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000",
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
  emptyState: {
    alignItems: "center",
    gap: 16,
  },
  gmailPrompt: {
    borderWidth: 1.5,
    borderColor: "#000",
    borderRadius: 22,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  gmailPromptText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "600",
  },
  cardPressable: {
    margin: 4,
  },
  cardPressed: {
    opacity: 0.75,
  },
  cardSelected: {},
  selectedBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2.5,
    borderColor: "#000",
    borderRadius: 12,
    zIndex: 3,
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
  },
  imageContainer: {
    position: "relative",
    width: "100%",
  },
  image: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 12,
  },
  cpwBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  cpwText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  categoryBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  categoryBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  cardContent: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 2,
  },
  nameWrap: {
    overflow: "hidden",
  },
  itemName: {
    flexShrink: 1,
  },
  nameFade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 28,
  },
  itemBrand: {
    fontSize: 11,
    opacity: 0.65,
    textAlign: "center",
  },
  wearSuffix: {
    fontSize: 11,
    opacity: 0.55,
  },
});
