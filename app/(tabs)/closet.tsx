import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type Category } from "@/components/category-picker";
import { PasteImageButton } from "@/components/paste-image-button";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import {
  addCategory,
  chunkPairs,
  deleteCategory,
  groupByCategory,
  listCategories,
  reorderCategories,
  type CategoryRow,
  type CategorySection,
} from "@/lib/categories";
import { writeClipboardImageToLocalUri } from "@/lib/clipboard-image";
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
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [hasGmailAccess, setHasGmailAccess] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const newCategoryInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (addingCategory) {
      const t = setTimeout(() => newCategoryInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [addingCategory]);

  const loadCategories = useCallback(() => {
    return listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

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
  const inputBackground = useThemeColor({ light: "#ffffff" }, "background");
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

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = item.category ?? "uncategorized";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const sections = useMemo(
    () => groupByCategory(filteredItems, categories),
    [filteredItems, categories],
  );

  const draggableSections = useMemo(
    () => sections.filter((s) => s.key !== "uncategorized"),
    [sections],
  );
  const uncategorizedSection = useMemo(
    () => sections.find((s) => s.key === "uncategorized"),
    [sections],
  );
  const canReorderSections = !searchQuery.trim() && !categoryFilter;

  useFocusEffect(
    useCallback(() => {
      loadItems({ silent: true });
      loadCategories();
      checkGmailAccess();
    }, [loadItems, loadCategories, checkGmailAccess]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadItems({ silent: true });
  }, [loadItems]);

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name || savingCategory) return;
    setSavingCategory(true);
    try {
      await addCategory(name);
      setNewCategoryName("");
      setAddingCategory(false);
      await loadCategories();
    } catch (e) {
      Alert.alert("Could not add category", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSavingCategory(false);
    }
  }

  function cancelAddCategory() {
    setAddingCategory(false);
    setNewCategoryName("");
  }

  function closeCategorySheet() {
    setShowCategorySheet(false);
    cancelAddCategory();
  }

  const handleDeleteCategory = useCallback(
    (category: CategoryRow) => {
      Alert.alert(
        "Delete category?",
        `Items in "${category.name}" will move to Uncategorized.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setDeletingCategoryId(category.id);
              try {
                await deleteCategory(category);
                setCategoryFilter((prev) => (prev === category.name ? null : prev));
                await Promise.all([loadCategories(), loadItems({ silent: true })]);
              } catch (e) {
                Alert.alert("Could not delete category", e instanceof Error ? e.message : "Unknown error");
              } finally {
                setDeletingCategoryId(null);
              }
            },
          },
        ],
      );
    },
    [loadCategories, loadItems],
  );

  const handleReorderCategories = useCallback(
    (reordered: CategoryRow[]) => {
      setCategories(reordered);
      reorderCategories(reordered.map((c) => c.id)).catch((e) => {
        Alert.alert(
          "Could not save order",
          e instanceof Error ? e.message : "Unknown error",
        );
        loadCategories();
      });
    },
    [loadCategories],
  );

  const handleCategoryDragEnd = useCallback(
    ({ data }: { data: CategoryRow[] }) => handleReorderCategories(data),
    [handleReorderCategories],
  );

  const handleSectionDragEnd = useCallback(
    ({ data }: { data: CategorySection<ClothingItem>[] }) => {
      const newOrderNames = data.map((s) => s.key);
      const visible = new Set(newOrderNames);
      const byName = new Map(categories.map((c) => [c.name, c]));
      let cursor = 0;
      const reordered = categories.map((c) =>
        visible.has(c.name) ? byName.get(newOrderNames[cursor++])! : c,
      );
      handleReorderCategories(reordered);
    },
    [categories, handleReorderCategories],
  );

  const renderCategoryItem = useCallback(
    ({ item: cat, drag, isActive }: RenderItemParams<CategoryRow>) => {
      const active = categoryFilter === cat.name;
      return (
        <View style={[styles.categoryRow, isActive && styles.categoryRowDragging]}>
          <Pressable
            onLongPress={drag}
            disabled={isActive}
            hitSlop={8}
            style={styles.categoryDragHandle}
            accessibilityRole="button"
            accessibilityLabel={`Reorder ${cat.name}`}
          >
            <Ionicons name="reorder-three-outline" size={20} color={placeholderColor} />
          </Pressable>
          <Pressable
            onPress={() => { setCategoryFilter(active ? null : cat.name); closeCategorySheet(); }}
            style={[styles.sheetOption, styles.categoryRowOption, active && styles.sheetOptionActive]}
          >
            <ThemedText style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>
              {cat.name.charAt(0).toUpperCase() + cat.name.slice(1)}{" "}
              <ThemedText style={styles.sheetOptionCount}>
                ({categoryCounts.get(cat.name) ?? 0})
              </ThemedText>
            </ThemedText>
            {active && <Ionicons name="checkmark" size={18} color="#fff" />}
          </Pressable>
          <Pressable
            onPress={() => handleDeleteCategory(cat)}
            disabled={deletingCategoryId === cat.id}
            hitSlop={8}
            style={styles.categoryDeleteBtn}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${cat.name} category`}
          >
            {deletingCategoryId === cat.id ? (
              <ActivityIndicator size="small" />
            ) : (
              <Ionicons name="trash-outline" size={18} color="#C00" />
            )}
          </Pressable>
        </View>
      );
    },
    [categoryFilter, deletingCategoryId, placeholderColor, handleDeleteCategory, categoryCounts],
  );

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

  // Picked here (while this screen is focused) rather than in add-closet-item,
  // since launching the native picker mid-navigation-transition causes it to
  // be dismissed almost immediately.
  async function addFromCamera() {
    setFabOpen(false);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera access", "Allow camera access in Settings.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        router.push({
          pathname: "/add-closet-item",
          params: { capturedUri: result.assets[0].uri },
        });
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open camera.");
    }
  }

  async function addFromLibrary() {
    setFabOpen(false);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Photo library", "Allow photo library access in Settings.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.85,
      });
      if (!result.canceled && result.assets.length > 0) {
        router.push({
          pathname: "/add-closet-item",
          params: { capturedUris: JSON.stringify(result.assets.map((a) => a.uri)) },
        });
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open library.");
    }
  }

  async function openAddItemWithClipboardImage(data: string) {
    const uri = await writeClipboardImageToLocalUri(data);
    router.push({
      pathname: "/add-closet-item",
      params: { capturedUri: uri },
    });
  }

  const { width: windowWidth } = useWindowDimensions();
  // Sized so ~3 cards are visible per row before scrolling horizontally, then scaled to 2/3
  const cardWidth = ((windowWidth - 24 - 24) / 3) * (2 / 3);

  const listBottomPad = Math.max(32, insets.bottom + 80);

  function renderClosetCard(item: ClothingItem, extraStyle?: { marginTop?: number; marginBottom?: number }) {
    const costPerWear = item.cost / Math.max(item.wears, 1);

    return (
      <Pressable
        onPress={() => router.push(`/edit-closet-item?id=${item.id}`)}
        style={({ pressed }) => [
          styles.cardPressable,
          { width: cardWidth },
          extraStyle,
          pressed && styles.cardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.name}`}
      >
        <ThemedView style={styles.card}>
          <View style={styles.imageContainer}>
            <Image
              source={item.image}
              style={styles.image}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          </View>
          <ThemedView style={styles.cardContent}>
            <ThemedText numberOfLines={1} style={styles.itemBrand}>
              <ThemedText style={styles.itemCpwInline}>
                {formatCurrency(costPerWear)}
              </ThemedText>
              {"  "}{formatCurrency(item.cost)}
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
  }

  function renderSection(
    section: CategorySection<ClothingItem>,
    opts?: { drag?: () => void; isActive?: boolean },
  ) {
    const isTwoRow = section.key === "top";
    return (
      <View style={[styles.sectionContainer, opts?.isActive && styles.sectionContainerActive]}>
        <Pressable
          onLongPress={canReorderSections ? opts?.drag : undefined}
          disabled={!canReorderSections || !opts?.drag || opts?.isActive}
          accessibilityRole={opts?.drag ? "button" : "text"}
          accessibilityLabel={opts?.drag ? `Reorder ${section.label} category` : undefined}
        >
          <ThemedText style={styles.sectionTitle}>
            {section.label}{" "}
            <ThemedText style={styles.sectionCount}>
              {section.items.length}
            </ThemedText>
          </ThemedText>
        </Pressable>
        {isTwoRow ? (
          <FlatList
            data={chunkPairs(section.items)}
            keyExtractor={(pair) => pair[0].id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionRow}
            renderItem={({ item: pair }) => (
              <View style={styles.columnPair}>
                {renderClosetCard(pair[0], { marginBottom: 0 })}
                {pair[1] ? (
                  renderClosetCard(pair[1], { marginTop: 0 })
                ) : (
                  <View style={{ width: cardWidth }} />
                )}
              </View>
            )}
          />
        ) : (
          <FlatList
            data={section.items}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionRow}
            renderItem={({ item }) => renderClosetCard(item)}
          />
        )}
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator style={styles.loading} size="large" />
        ) : (
          <DraggableFlatList
            data={draggableSections}
            keyExtractor={(section) => section.key}
            keyboardShouldPersistTaps="handled"
            activationDistance={8}
            onDragEnd={handleSectionDragEnd}
            ItemSeparatorComponent={() => <View style={styles.sectionDivider} />}
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
                  <Pressable
                    onPress={() => setShowCategorySheet(true)}
                    style={({ pressed }) => [
                      styles.sortBtn,
                      { borderColor, backgroundColor: inputBackground },
                      categoryFilter && styles.sortBtnActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Filter by category"
                  >
                    <Ionicons
                      name="filter-outline"
                      size={18}
                      color={categoryFilter ? "#fff" : textColor}
                    />
                  </Pressable>
                </View>
                {loadError ? (
                  <ThemedText style={styles.errorBanner}>
                    {loadError}
                  </ThemedText>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              loadError || sections.length > 0 ? null : items.length > 0 ? (
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
            renderItem={({ item: section, drag, isActive }) =>
              renderSection(section, { drag, isActive })
            }
            ListFooterComponent={
              uncategorizedSection ? (
                <>
                  {draggableSections.length > 0 && (
                    <View style={styles.sectionDivider} />
                  )}
                  {renderSection(uncategorizedSection)}
                </>
              ) : null
            }
          />
        )}
        {fabOpen ? (
          <>
            {hasGmailAccess && (
              <Pressable
                onPress={syncGmail}
                disabled={syncing}
                style={({ pressed }) => [
                  styles.fab,
                  styles.fabRect,
                  styles.fabRectOutline,
                  { bottom: insets.bottom + 304, right: 16 },
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
            <PasteImageButton
              size={{ width: 110, height: 60 }}
              style={{
                position: "absolute",
                bottom: insets.bottom + 232,
                right: 16,
                zIndex: 1,
                borderWidth: 1.5,
                borderColor: "#000",
              }}
              backgroundColor="#fff"
              foregroundColor="#000"
              onBeforePaste={() => setFabOpen(false)}
              onImage={openAddItemWithClipboardImage}
            >
              <ThemedText style={styles.fabRectLabel}>paste</ThemedText>
            </PasteImageButton>
            <Pressable
              onPress={() => {
                setFabOpen(false);
                router.push("/web-capture");
              }}
              style={({ pressed }) => [
                styles.fab,
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 160, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Capture item from the web"
            >
              <ThemedText style={styles.fabRectLabel}>from web</ThemedText>
            </Pressable>
            <Pressable
              onPress={addFromLibrary}
              style={({ pressed }) => [
                styles.fab,
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 88, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add items from library"
            >
              <ThemedText style={styles.fabRectLabel}>library</ThemedText>
            </Pressable>
            <Pressable
              onPress={addFromCamera}
              style={[
                styles.fab,
                styles.fabRect,
                styles.fabRectOutline,
                { bottom: insets.bottom + 16, right: 16 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add items with camera"
            >
              <ThemedText style={styles.fabRectLabel}>camera</ThemedText>
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
            {(
              [
                { label: "Cost/Wear", asc: "cpw_asc", desc: "cpw_desc" },
                { label: "Cost",      asc: "cost_asc", desc: "cost_desc" },
                { label: "Wears",     asc: "wears_asc", desc: "wears_desc" },
              ] as { label: string; asc: SortKey; desc: SortKey }[]
            ).map(({ label, asc, desc }) => (
              <View key={label} style={styles.sortRow}>
                <ThemedText style={styles.sortRowLabel}>{label}</ThemedText>
                <View style={styles.sortRowBtns}>
                  {([{ key: asc, text: "Low → High" }, { key: desc, text: "High → Low" }] as { key: SortKey; text: string }[]).map(({ key, text }) => {
                    const active = sortKey === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => { setSortKey(active ? null : key); setShowSortSheet(false); }}
                        style={[styles.sortDirBtn, active && styles.sortDirBtnActive]}
                      >
                        <ThemedText style={[styles.sortDirBtnText, active && styles.sortDirBtnTextActive]}>
                          {text}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
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

      {showCategorySheet && (
        <View style={styles.sheetModalRoot}>
        <Pressable
          style={styles.sheetOverlay}
          onPress={closeCategorySheet}
        >
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <ThemedText type="defaultSemiBold" style={styles.sheetTitleInRow}>
                Categories
              </ThemedText>
              <Pressable
                onPress={() => (addingCategory ? cancelAddCategory() : setAddingCategory(true))}
                hitSlop={8}
                style={styles.sheetTitleAddBtn}
                accessibilityRole="button"
                accessibilityLabel={addingCategory ? "Cancel adding category" : "Add category"}
              >
                <Ionicons name={addingCategory ? "close" : "add"} size={22} color={textColor} />
              </Pressable>
            </View>
            {addingCategory && (
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "position" : undefined}
                style={[
                  styles.addCategoryRow,
                  Platform.OS !== "ios" && styles.addCategoryRowContent,
                ]}
                contentContainerStyle={styles.addCategoryRowContent}
              >
                <TextInput
                  ref={newCategoryInputRef}
                  accessibilityLabel="New category name"
                  placeholder="New category name"
                  placeholderTextColor={placeholderColor}
                  value={newCategoryName}
                  onChangeText={setNewCategoryName}
                  onSubmitEditing={handleAddCategory}
                  editable={!savingCategory}
                  style={[styles.addCategoryInput, { borderColor, color: textColor }]}
                />
                <Pressable
                  onPress={handleAddCategory}
                  disabled={savingCategory || !newCategoryName.trim()}
                  style={({ pressed }) => [
                    styles.addCategoryBtn,
                    (savingCategory || !newCategoryName.trim()) && styles.fabDisabled,
                    pressed && { opacity: 0.8 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Add category"
                >
                  {savingCategory ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="add" size={20} color="#fff" />
                  )}
                </Pressable>
              </KeyboardAvoidingView>
            )}
            <Pressable
              onPress={() => { setCategoryFilter(null); closeCategorySheet(); }}
              style={[styles.sheetOption, !categoryFilter && styles.sheetOptionActive]}
            >
              <ThemedText style={[styles.sheetOptionText, !categoryFilter && styles.sheetOptionTextActive]}>
                All
              </ThemedText>
              {!categoryFilter && <Ionicons name="checkmark" size={18} color="#fff" />}
            </Pressable>
            <DraggableFlatList
              data={categories}
              keyExtractor={(cat) => cat.id}
              scrollEnabled={false}
              activationDistance={8}
              onDragEnd={handleCategoryDragEnd}
              renderItem={renderCategoryItem}
            />
            <Pressable
              onPress={closeCategorySheet}
              style={({ pressed }) => [styles.sheetCancel, pressed && { opacity: 0.7 }]}
            >
              <ThemedText style={styles.sheetCancelText}>Cancel</ThemedText>
            </Pressable>
          </View>
        </Pressable>
        </View>
      )}
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
  sheetModalRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    elevation: 20,
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
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sheetTitleInRow: {
    fontSize: 15,
  },
  sheetTitleAddBtn: {
    padding: 4,
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
  sheetOptionCount: {
    fontSize: 15,
    color: "#8E8E93",
  },
  sheetOptionTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  categoryRowDragging: {
    opacity: 0.6,
  },
  categoryDragHandle: {
    padding: 8,
  },
  categoryRowOption: {
    flex: 1,
  },
  categoryDeleteBtn: {
    padding: 10,
  },
  addCategoryRow: {
    marginTop: 6,
  },
  addCategoryRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addCategoryInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  addCategoryBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
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
  sectionContainer: {
    marginBottom: 3,
  },
  sectionContainerActive: {
    opacity: 0.85,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "rgba(128,128,128,0.45)",
    marginVertical: 2,
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: 4,
  },
  sectionCount: {
    fontSize: 15,
    color: "#8E8E93",
  },
  sectionRow: {
    paddingRight: 8,
  },
  columnPair: {
    flexDirection: "column",
  },
  cardPressable: {
    margin: 2,
  },
  cardPressed: {
    opacity: 0.75,
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
  itemCpwInline: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 1,
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
    paddingTop: 0,
    paddingBottom: 6,
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
    color: "#666666",
    textAlign: "center",
  },
  wearSuffix: {
    fontSize: 11,
    opacity: 0.55,
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sortRowLabel: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  sortRowBtns: {
    flexDirection: "row",
    gap: 6,
  },
  sortDirBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#f2f2f7",
  },
  sortDirBtnActive: {
    backgroundColor: "#000",
  },
  sortDirBtnText: {
    fontSize: 13,
    fontWeight: "500",
  },
  sortDirBtnTextActive: {
    color: "#fff",
  },
});
