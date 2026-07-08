import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MultiCategoryPicker } from "@/components/category-picker";
import { DayTileOutfits } from "@/components/day-tile-outfits";
import { StaticOutfitBoard } from "@/components/outfit-board-static";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import {
  chunkPairs,
  DAILY_STACK_CATEGORY_NAME,
  groupByCategory,
  listCategories,
  type CategoryRow,
} from "@/lib/categories";
import {
  type DayOutfit,
  adjustWears,
  deleteOutfit,
  getOutfitsForDate,
  getWornItemIdsForDate,
  saveOutfitItemsOnly,
} from "@/lib/outfit-storage";
import { useTabNavigation } from "@/lib/tab-navigation";
import { getWeatherMap } from "@/lib/weather";
import { getSupabase } from "@/lib/supabase-client";

type ClosetItem = {
  id: string;
  brand: string;
  name: string;
  imageUri: string | null;
  cost: number;
  wears: number;
  category: string | null;
};

async function loadCloset(): Promise<ClosetItem[]> {
  const { data, error } = await getSupabase()
    .from("closet")
    .select("id, brand, name, image, cost, wears, category")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const costRaw = row.cost as number | string | null;
    const cost =
      typeof costRaw === "string"
        ? parseFloat(costRaw)
        : typeof costRaw === "number"
          ? costRaw
          : 0;
    return {
      id: String(row.id),
      brand: ((row.brand as string | null) ?? "").trim(),
      name: (row.name as string) ?? "",
      imageUri: ((row.image as string | null) ?? "").trim() || null,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
      wears: typeof row.wears === "number" && row.wears >= 0 ? row.wears : 0,
      category: (row.category as string | null) ?? null,
    };
  });
}

type SortKey =
  | "cpw_asc"
  | "cpw_desc"
  | "cost_asc"
  | "cost_desc"
  | "wears_asc"
  | "wears_desc";

function sortItems(items: ClosetItem[], key: SortKey): ClosetItem[] {
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

/** "2026-07-06" → { weekday: "Monday", rest: "July 6, 2026" }. Parsed by parts to avoid a UTC timezone shift. */
function formatDateTitle(dateKey: string): { weekday: string; rest: string } | null {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "long" }),
    rest: date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export default function DayOutfitsScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const { goToTab } = useTabNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const dateKey = typeof date === "string" ? date : "";
  const [list, setList] = useState<DayOutfit[]>([]);
  const [closetItems, setClosetItems] = useState<ClosetItem[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [maxTemp, setMaxTemp] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(
    new Set(),
  );
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#ffffff" }, "background");

  // Sized so ~3 cards are visible per row before scrolling horizontally, then scaled to 2/3
  const cardWidth = ((windowWidth - 24 - 24) / 3) * (2 / 3);

  const refresh = useCallback(async () => {
    if (!dateKey) return;
    const [rows, items] = await Promise.all([
      getOutfitsForDate(dateKey),
      loadCloset(),
    ]);
    setList(rows);
    setClosetItems(items);
    return rows;
  }, [dateKey]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!dateKey) return;
      Promise.all([getOutfitsForDate(dateKey), loadCloset()]).then(
        ([rows, items]) => {
          if (active) {
            setList(rows);
            setClosetItems(items);
          }
        },
      );
      listCategories()
        .then((rows) => {
          if (active) setCategories(rows);
        })
        .catch(() => {
          if (active) setCategories([]);
        });
      getWeatherMap()
        .then((w) => {
          if (active && dateKey in w) setMaxTemp(w[dateKey]);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [dateKey]),
  );

  const itemData = useMemo(() => {
    const map: Record<
      string,
      { name: string; image: string | null; cost: number; wears: number }
    > = {};
    for (const it of closetItems) {
      map[it.id] = {
        name: it.brand ? `${it.brand} · ${it.name}` : it.name,
        image: it.imageUri,
        cost: it.cost,
        wears: it.wears,
      };
    }
    return map;
  }, [closetItems]);

  // Daily Stack items accrue wears automatically and are auto-appended to every
  // outfit at save time — they aren't manually toggleable here.
  const dailyStackItemIds = useMemo(
    () =>
      closetItems
        .filter((i) => i.category === DAILY_STACK_CATEGORY_NAME)
        .map((i) => i.id),
    [closetItems],
  );
  const dailyStackIdSet = useMemo(
    () => new Set(dailyStackItemIds),
    [dailyStackItemIds],
  );
  const pickableItems = useMemo(
    () => closetItems.filter((i) => !dailyStackIdSet.has(i.id)),
    [closetItems, dailyStackIdSet],
  );

  const categoryNames = useMemo(
    () =>
      categories
        .map((c) => c.name)
        .filter((name) => name !== DAILY_STACK_CATEGORY_NAME),
    [categories],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of pickableItems) {
      const key = item.category ?? "uncategorized";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [pickableItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = pickableItems.filter((item) => {
      if (
        categoryFilter.size > 0 &&
        (!item.category || !categoryFilter.has(item.category))
      )
        return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q)
      );
    });
    return sortKey ? sortItems(filtered, sortKey) : filtered;
  }, [pickableItems, searchQuery, categoryFilter, sortKey]);

  const sections = useMemo(() => {
    const grouped = groupByCategory(filteredItems, categories);
    if (categoryFilter.size === 0) return grouped;
    // Sets iterate in insertion order, so this ranks sections by tap order.
    const rank = new Map(
      Array.from(categoryFilter).map((name, i) => [name, i]),
    );
    return [...grouped].sort(
      (a, b) =>
        (rank.get(a.key) ?? rank.size) - (rank.get(b.key) ?? rank.size),
    );
  }, [filteredItems, categories, categoryFilter]);

  const selectedCount = selectedIds.size;
  const selectedKey = Array.from(selectedIds).sort().join(",");

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCategoryFilter(name: string) {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function goMakeOutfitBoard() {
    goToTab("closet");
    router.navigate({
      pathname: "/(tabs)/closet",
      params: { outfitForDate: dateKey },
    });
  }

  async function saveSelectedOutfit() {
    if (selectedCount === 0 || saving) return;
    setSaving(true);
    try {
      const newIds = Array.from(selectedIds).filter(
        (id) => !dailyStackIdSet.has(id),
      );
      // Wears cap at one per item per day — skip items already in another
      // outfit on this date.
      const alreadyWorn = await getWornItemIdsForDate(dateKey);
      await adjustWears(
        newIds.filter((id) => !alreadyWorn.has(id)),
        1,
      );
      // Daily Stack items are always part of the outfit, appended at the end.
      await saveOutfitItemsOnly([...newIds, ...dailyStackItemIds], dateKey);
      setSelectedIds(new Set());
      await refresh();
    } catch (e) {
      Alert.alert(
        "Error",
        e instanceof Error ? e.message : "Could not save outfit",
      );
    } finally {
      setSaving(false);
    }
  }

  const confirmDelete = (outfit: DayOutfit) => {
    Alert.alert(
      "Delete outfit",
      "Remove this outfit, its photo, and undo wear counts for the items you selected?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(outfit.id);
            try {
              await deleteOutfit(dateKey, outfit.id);
              // Update list immediately from local state so the UI responds
              // even if the subsequent Supabase refresh is slow or fails.
              setList((prev) => prev.filter((o) => o.id !== outfit.id));
              // Best-effort background refresh to sync item metadata.
              refresh().catch(() => {});
            } catch (e) {
              Alert.alert(
                "Error",
                e instanceof Error ? e.message : "Could not delete",
              );
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  function renderOutfitCard(item: DayOutfit, index: number) {
    const itemsWithData = item.itemIds.map((id) => ({
      id,
      ...(itemData[id] ?? { name: id, image: null, cost: 0, wears: 0 }),
    }));

    const totalCPW = itemsWithData.reduce(
      (sum, it) => sum + it.cost / Math.max(it.wears, 1),
      0,
    );

    return (
      <Pressable
        key={item.id}
        onPress={() => {
          if (item.board) {
            goToTab("closet");
            router.navigate({
              pathname: "/(tabs)/closet",
              params: { outfitForDate: dateKey, editDayOutfitId: item.id },
            });
            return;
          }
          router.push({
            pathname: "/log-outfit",
            params: {
              date: dateKey,
              outfitId: item.id,
              itemIds: item.itemIds.join(","),
              photoUri: item.photoUri ?? "",
            },
          });
        }}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={`Edit outfit ${index + 1}`}
      >
        <View style={styles.cardHeader}>
          <ThemedText type="defaultSemiBold" style={styles.cardTitle}>
            Outfit {index + 1}
          </ThemedText>
          {itemsWithData.length > 0 && (
            <View style={styles.cpwBadge}>
              <Text style={styles.cpwText}>${totalCPW.toFixed(2)}/wear</Text>
            </View>
          )}
          <Pressable
            onPress={(e) => { e.stopPropagation(); confirmDelete(item); }}
            disabled={deletingId !== null}
            style={styles.deleteBtn}
            accessibilityLabel="Delete outfit"
            hitSlop={8}
          >
            {deletingId === item.id ? (
              <ActivityIndicator size="small" color="#dc2626" />
            ) : (
              <Ionicons
                name="trash-outline"
                size={22}
                color="#dc2626"
              />
            )}
          </Pressable>
        </View>

        {item.photoUri ? (
          <Image
            source={{ uri: item.photoUri }}
            style={styles.photo}
            contentFit="cover"
          />
        ) : item.board ? (
          <View
            style={[
              styles.boardThumb,
              { aspectRatio: item.board.canvasW / item.board.canvasH },
            ]}
          >
            <StaticOutfitBoard
              canvasW={item.board.canvasW}
              canvasH={item.board.canvasH}
              items={item.board.items.map((bi) => ({
                ...bi,
                image: itemData[bi.id]?.image ?? null,
              }))}
            />
          </View>
        ) : itemsWithData.length > 0 ? (
          <View style={styles.itemGridThumb}>
            <DayTileOutfits
              imageUris={
                itemsWithData
                  .map(({ image }) => image)
                  .filter((uri): uri is string => !!uri)
              }
            />
          </View>
        ) : null}

        {item.photoUri && itemsWithData.length > 0 && (
          <>
            <ThemedText style={styles.itemsLabel}>
              Items worn
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.itemStrip}
            >
              {itemsWithData.map(({ id, name, image }) => (
                <View key={id} style={styles.itemThumb}>
                  {image ? (
                    <Image
                      source={{ uri: image }}
                      style={styles.itemThumbImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.itemThumbPlaceholder}>
                      <Ionicons
                        name="shirt-outline"
                        size={20}
                        color="rgba(128,128,128,0.6)"
                      />
                    </View>
                  )}
                  <ThemedText
                    numberOfLines={2}
                    style={styles.itemThumbLabel}
                  >
                    {name}
                  </ThemedText>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {itemsWithData.length === 0 && (
          <ThemedText style={styles.muted}>
            No items selected
          </ThemedText>
        )}
      </Pressable>
    );
  }

  function renderItemCard(
    item: ClosetItem,
    extraStyle?: { marginTop?: number; marginBottom?: number },
  ) {
    const isSelected = selectedIds.has(item.id);
    const cpw = item.cost / Math.max(item.wears, 1);
    return (
      <Pressable
        onPress={() => toggleItem(item.id)}
        style={({ pressed }) => [
          styles.itemCardPressable,
          { width: cardWidth },
          extraStyle,
          pressed && { opacity: 0.75 },
        ]}
        accessibilityRole="checkbox"
        accessibilityLabel={item.name}
        accessibilityState={{ checked: isSelected }}
      >
        <ThemedView style={styles.itemCard}>
          {item.imageUri ? (
            <Image
              source={{ uri: item.imageUri }}
              style={styles.itemCardImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.itemCardImage, styles.itemCardImagePlaceholder]}>
              <Ionicons
                name="shirt-outline"
                size={28}
                color="rgba(128,128,128,0.5)"
              />
            </View>
          )}

          {isSelected && (
            <>
              <View style={styles.selectedBorder} pointerEvents="none" />
              <View style={styles.selectedOverlay}>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
              </View>
            </>
          )}

          <View style={styles.itemCardLabel}>
            <ThemedText numberOfLines={1} style={styles.itemBrand}>
              ${cpw.toFixed(2)}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    );
  }

  function renderSection(section: (typeof sections)[number]) {
    const isTwoRow = section.key === "top";
    return (
      <View style={styles.sectionContainer}>
        <ThemedText style={styles.sectionTitle}>
          {section.label}{" "}
          <ThemedText style={styles.sectionCount}>
            {section.items.length}
          </ThemedText>
        </ThemedText>
        {isTwoRow ? (
          <FlatList
            data={chunkPairs(section.items)}
            keyExtractor={(pair) => pair[0].id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionRow}
            renderItem={({ item: pair }) => (
              <View style={styles.columnPair}>
                {renderItemCard(pair[0], { marginBottom: 0 })}
                {pair[1] ? (
                  renderItemCard(pair[1], { marginTop: 0 })
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
            renderItem={({ item }) => renderItemCard(item)}
          />
        )}
      </View>
    );
  }

  if (!dateKey) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText>Invalid date</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </ThemedView>
    );
  }

  const listHeader = (
    <View>
      <View style={styles.subtitleRow}>
        <ThemedText style={styles.subtitle}>
          {list.length} outfit{list.length === 1 ? "" : "s"} this day
        </ThemedText>
        {maxTemp !== null && (
          <ThemedText style={styles.tempBadge}>🌡 {maxTemp}°F</ThemedText>
        )}
      </View>

      <View style={styles.outfitList}>
        {list.map((outfit, index) => renderOutfitCard(outfit, index))}
      </View>

      <View style={styles.pickerHeader}>
        <ThemedText type="defaultSemiBold" style={styles.pickerTitle}>
          Make an outfit
        </ThemedText>
        <Pressable
          onPress={goMakeOutfitBoard}
          style={({ pressed }) => [
            styles.makeBoardBtn,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Make outfit board for this day"
        >
          <Ionicons name="grid-outline" size={14} color="#fff" />
          <Text style={styles.makeBoardBtnText}>outfit board</Text>
        </Pressable>
      </View>

      <MultiCategoryPicker
        values={categoryFilter}
        onToggle={toggleCategoryFilter}
        categories={categoryNames}
        disabled={saving}
      />

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
            categoryFilter.size > 0 && styles.sortBtnActive,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Filter by category"
        >
          <Ionicons
            name="filter-outline"
            size={18}
            color={categoryFilter.size > 0 ? "#fff" : textColor}
          />
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ThemedView style={styles.container}>
        <View style={styles.compactHeader}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [
              styles.compactHeaderBack,
              { opacity: pressed ? 0.5 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={24} color={textColor} />
          </Pressable>
          <ThemedText numberOfLines={1} style={styles.compactHeaderTitle}>
            {(() => {
              const parts = formatDateTitle(dateKey);
              if (!parts) return dateKey;
              return (
                <>
                  {parts.weekday}
                  <ThemedText style={[styles.compactHeaderTitle, styles.compactHeaderPipe]}>
                    {"  ·  "}
                  </ThemedText>
                  {parts.rest}
                </>
              );
            })()}
          </ThemedText>
          <View style={styles.compactHeaderBack} />
        </View>
        <FlatList
          data={sections}
          keyExtractor={(section) => section.key}
          extraData={selectedKey}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.sectionDivider} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <ThemedText style={styles.emptySearch}>
              {pickableItems.length > 0
                ? "No items match your search."
                : "No items in your closet yet."}
            </ThemedText>
          }
          renderItem={({ item: section }) => renderSection(section)}
        />

        {selectedCount > 0 ? (
          <Pressable
            onPress={saveSelectedOutfit}
            disabled={saving}
            style={({ pressed }) => [
              styles.addOutfitBtn,
              { marginBottom: insets.bottom + 12 },
              pressed && { opacity: 0.8 },
              saving && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save outfit"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText
                style={styles.addOutfitBtnLabel}
                lightColor="#fff"
                darkColor="#fff"
              >
                Save outfit ({selectedCount} item{selectedCount !== 1 ? "s" : ""})
              </ThemedText>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push(`/log-outfit?date=${dateKey}`)}
            style={({ pressed }) => [
              styles.addOutfitBtn,
              { marginBottom: insets.bottom + 12 },
              pressed && { opacity: 0.8 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add outfit"
          >
            <ThemedText
              style={styles.addOutfitBtnLabel}
              lightColor="#fff"
              darkColor="#fff"
            >
              + Add outfit
            </ThemedText>
          </Pressable>
        )}

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

        <Modal
          visible={showCategorySheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowCategorySheet(false)}
        >
          <Pressable
            style={styles.sheetOverlay}
            onPress={() => setShowCategorySheet(false)}
          >
            <View style={styles.sheetContainer}>
              <View style={styles.sheetHandle} />
              <ThemedText type="defaultSemiBold" style={styles.sheetTitle}>
                Categories
              </ThemedText>
              <Pressable
                onPress={() => setCategoryFilter(new Set())}
                style={[styles.sheetOption, categoryFilter.size === 0 && styles.sheetOptionActive]}
              >
                <ThemedText style={[styles.sheetOptionText, categoryFilter.size === 0 && styles.sheetOptionTextActive]}>
                  All
                </ThemedText>
                {categoryFilter.size === 0 && <Ionicons name="checkmark" size={18} color="#fff" />}
              </Pressable>
              {categoryNames.map((name) => {
                const active = categoryFilter.has(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() => toggleCategoryFilter(name)}
                    style={[styles.sheetOption, active && styles.sheetOptionActive]}
                  >
                    <ThemedText style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>
                      {name.charAt(0).toUpperCase() + name.slice(1)}{" "}
                      <ThemedText style={styles.sheetOptionCount}>
                        ({categoryCounts.get(name) ?? 0})
                      </ThemedText>
                    </ThemedText>
                    {active && <Ionicons name="checkmark" size={18} color="#fff" />}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setShowCategorySheet(false)}
                style={({ pressed }) => [styles.sheetCancel, pressed && { opacity: 0.7 }]}
              >
                <ThemedText style={styles.sheetCancelText}>Done</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    marginBottom: 4,
  },
  compactHeaderBack: {
    width: 28,
    alignItems: "flex-start",
  },
  compactHeaderTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
  },
  compactHeaderPipe: {
    color: "#8E8E93",
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  subtitle: {
    opacity: 0.8,
  },
  tempBadge: {
    fontSize: 13,
    opacity: 0.7,
  },
  list: {
    paddingBottom: 40,
  },
  outfitList: {
    gap: 16,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(128,128,128,0.35)",
    padding: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
  },
  cpwBadge: {
    backgroundColor: "rgba(0,0,0,0.07)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
  },
  cpwText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#444",
  },
  deleteBtn: {
    padding: 6,
  },
  photo: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.2)",
  },
  itemGridThumb: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(128,128,128,0.2)",
  },
  boardThumb: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  itemsLabel: {
    fontWeight: "600",
    marginTop: 4,
  },
  itemStrip: {
    gap: 10,
    paddingVertical: 4,
  },
  itemThumb: {
    width: 72,
    alignItems: "center",
    gap: 4,
  },
  itemThumbImage: {
    width: 72,
    height: 96,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
  },
  itemThumbPlaceholder: {
    width: 72,
    height: 96,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  itemThumbLabel: {
    fontSize: 11,
    textAlign: "center",
    opacity: 0.75,
  },
  muted: {
    opacity: 0.6,
  },
  pickerHeader: {
    marginTop: 24,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  pickerTitle: {
    fontSize: 17,
  },
  makeBoardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#000",
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 30,
  },
  makeBoardBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  pickerHint: {
    fontSize: 13,
    opacity: 0.6,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginTop: 12,
    marginBottom: 12,
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
  sectionContainer: {
    marginBottom: 3,
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
  sectionDivider: {
    height: 1,
    backgroundColor: "rgba(128,128,128,0.45)",
    marginVertical: 6,
  },
  columnPair: {
    flexDirection: "column",
  },
  itemCardPressable: {
    margin: 2,
  },
  itemCard: {
    borderRadius: 12,
    overflow: "hidden",
  },
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
    zIndex: 4,
    backgroundColor: "rgba(10,126,164,0.75)",
    borderRadius: 14,
  },
  itemCardImage: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 12,
  },
  itemCardImagePlaceholder: {
    backgroundColor: "rgba(128,128,128,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  itemCardLabel: {
    paddingTop: 0,
    paddingBottom: 6,
    paddingHorizontal: 4,
    gap: 2,
  },
  itemBrand: {
    fontSize: 11,
    color: "#666666",
    textAlign: "center",
  },
  emptySearch: {
    textAlign: "center",
    marginTop: 24,
    opacity: 0.7,
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
  sheetOptionCount: {
    fontSize: 15,
    color: "#8E8E93",
  },
  sheetOptionTextActive: {
    color: "#fff",
    fontWeight: "600",
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
  addOutfitBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  addOutfitBtnLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
  backBtn: {
    padding: 12,
  },
  backBtnText: {
    color: "#2563eb",
    fontWeight: "600",
  },
});
