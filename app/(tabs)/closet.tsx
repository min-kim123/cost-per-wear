import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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
import {
  OUTFIT_ITEM_H,
  OUTFIT_ITEM_W,
  OutfitBoard,
  type OutfitBoardSnapshot,
} from "@/components/outfit-board";
import { PasteImageButton } from "@/components/paste-image-button";
import { Swirl } from "@/components/swirl";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import {
  addCategory,
  chunkPairs,
  DAILY_STACK_CATEGORY_NAME,
  deleteCategory,
  groupByCategory,
  listCategories,
  reorderCategories,
  reorderClosetItems,
  type CategoryRow,
  type CategorySection,
} from "@/lib/categories";
import { writeClipboardImageToLocalUri } from "@/lib/clipboard-image";
import {
  adjustWears,
  getOutfitsForDate,
  getWornItemIdsForDate,
  saveOutfitItemsOnly,
  updateOutfitBoard,
} from "@/lib/outfit-storage";
import {
  addSavedOutfit,
  deleteSavedOutfit,
  formatBoardDate,
  listSavedOutfits,
  updateSavedOutfit,
  type SavedOutfit,
} from "@/lib/saved-outfits";
import { subscribeClosetSaves } from "@/lib/closet-save-queue";
import { useDevToggle } from "@/lib/dev-toggles";
import { saveToCameraRoll } from "@/lib/save-to-camera-roll";
import { getSupabase } from "@/lib/supabase-client";
import { useTabSwipeLock } from "@/lib/tab-swipe-lock";

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
    .order("position", { ascending: true, nullsFirst: true })
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

type MetricDisplay = "cpw" | "wears" | "cost";

const METRIC_OPTIONS: { key: MetricDisplay; label: string }[] = [
  { key: "cpw", label: "Cost per wear" },
  { key: "wears", label: "Amount of wears" },
  { key: "cost", label: "Initial cost" },
];

function formatMetric(item: ClothingItem, metric: MetricDisplay): string {
  switch (metric) {
    case "cpw":
      return formatCurrency(item.cost / Math.max(item.wears, 1));
    case "wears":
      return `${item.wears} ${item.wears === 1 ? "wear" : "wears"}`;
    case "cost":
      return formatCurrency(item.cost);
  }
}

/** "2026-07-06" → "Monday, July 6". Parsed by parts to avoid a UTC timezone shift. */
function formatOutfitDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

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
  const [metricDisplay, setMetricDisplay] = useState<MetricDisplay | null>("cpw");
  const [showMetricSheet, setShowMetricSheet] = useState(false);
  const { hidden: categoriesButtonHidden } = useDevToggle("closet:categories");
  const { hidden: metricButtonHidden } = useDevToggle("closet:metric");
  const [hasGmailAccess, setHasGmailAccess] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const newCategoryInputRef = useRef<TextInput>(null);
  const [footerAdding, setFooterAdding] = useState(false);
  const [footerCategoryName, setFooterCategoryName] = useState("");
  const footerInputRef = useRef<TextInput>(null);
  // Section keys whose rows are expanded into a wrapped grid (no horizontal
  // scroll); toggled by the swirl button on each section header.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const [outfitMode, setOutfitMode] = useState(false);
  // Set when the board was opened from a calendar day (via the "make outfit
  // board" button on that day's page) — saving writes a dated outfit instead
  // of a reusable saved-outfit board, and the board header shows the date.
  const [outfitForDate, setOutfitForDate] = useState<string | null>(null);
  const [boardItems, setBoardItems] = useState<ClothingItem[]>([]);
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>([]);
  const [savingOutfit, setSavingOutfit] = useState(false);
  const [editingOutfitId, setEditingOutfitId] = useState<string | null>(null);
  // Set when editing an existing dated outfit's board (tapped from the day
  // page) — saving updates that outfit row instead of inserting a new one.
  const [editingDayOutfitId, setEditingDayOutfitId] = useState<string | null>(
    null,
  );
  const editingDayOutfitOriginalIdsRef = useRef<Set<string>>(new Set());
  const [editingSnapshot, setEditingSnapshot] =
    useState<OutfitBoardSnapshot | null>(null);
  const boardDirtyRef = useRef(false);
  const boardHistoryPushedRef = useRef(false);
  const ignoreBoardPopRef = useRef(false);
  const markBoardDirty = useCallback(() => {
    boardDirtyRef.current = true;
  }, []);

  const dismissBoardHistory = useCallback(() => {
    if (Platform.OS !== "web" || !boardHistoryPushedRef.current) return;
    boardHistoryPushedRef.current = false;
    ignoreBoardPopRef.current = true;
    window.history.back();
  }, []);
  const { setSwipeLocked } = useTabSwipeLock();

  useEffect(() => {
    if (Platform.OS !== "web") return;
    setSwipeLocked(boardExpanded);
    return () => setSwipeLocked(false);
  }, [boardExpanded, setSwipeLocked]);

  useEffect(() => {
    if (addingCategory) {
      const t = setTimeout(() => newCategoryInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [addingCategory]);

  useEffect(() => {
    if (footerAdding) {
      const t = setTimeout(() => footerInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [footerAdding]);

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

  // Empty categories stay visible in the default view; hide them while
  // searching or filtering so those views only show matching sections.
  const sections = useMemo(
    () =>
      groupByCategory(filteredItems, categories, {
        includeEmpty: !searchQuery.trim() && !categoryFilter,
      }),
    [filteredItems, categories, searchQuery, categoryFilter],
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
  // Item drag-to-reorder only makes sense when the row shows the real stored
  // order — not a searched subset or a computed sort. (Native only: the
  // draggable list breaks scrolling on web.)
  const canReorderItems =
    Platform.OS !== "web" && !searchQuery.trim() && !sortKey;

  const loadSavedOutfits = useCallback(() => {
    return listSavedOutfits()
      .then(setSavedOutfits)
      .catch(() => setSavedOutfits([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadItems({ silent: true });
      loadCategories();
      checkGmailAccess();
      loadSavedOutfits();
    }, [loadItems, loadCategories, checkGmailAccess, loadSavedOutfits]),
  );

  // Items save in the background after the add-item modal dismisses; refresh
  // as each one lands so they appear without a manual pull-to-refresh.
  const lastSaveDone = useRef(0);
  useEffect(
    () =>
      subscribeClosetSaves((s) => {
        if (s.done !== lastSaveDone.current) {
          lastSaveDone.current = s.done;
          if (s.done > 0) loadItems({ silent: true });
        }
      }),
    [loadItems],
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

  async function handleFooterAddCategory() {
    const name = footerCategoryName.trim();
    if (!name || savingCategory) return;
    setSavingCategory(true);
    try {
      await addCategory(name);
      setFooterCategoryName("");
      setFooterAdding(false);
      await loadCategories();
    } catch (e) {
      Alert.alert("Could not add category", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSavingCategory(false);
    }
  }

  function cancelFooterAddCategory() {
    setFooterAdding(false);
    setFooterCategoryName("");
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

  const handleItemsDragEnd = useCallback(
    (sectionKey: string, ordered: ClothingItem[]) => {
      // Splice the section's new order back into the full items list so every
      // derived view (sections, filters) updates immediately.
      setItems((prev) => {
        const queue = [...ordered];
        return prev.map((it) =>
          (it.category ?? "uncategorized") === sectionKey
            ? (queue.shift() ?? it)
            : it,
        );
      });
      reorderClosetItems(ordered.map((i) => i.id)).catch((e) => {
        Alert.alert(
          "Could not save order",
          e instanceof Error ? e.message : "Unknown error",
        );
        loadItems({ silent: true });
      });
    },
    [loadItems],
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

  // Tapping a closet card in outfit mode adds/removes it on the board right
  // away — the mini preview reflects the selection live.
  function toggleOutfitSelected(item: ClothingItem) {
    setBoardItems((prev) =>
      prev.some((i) => i.id === item.id)
        ? prev.filter((i) => i.id !== item.id)
        : [...prev, item],
    );
  }

  function handleDoneSelecting() {
    if (boardItems.length === 0) {
      exitOutfitMode();
      return;
    }
    setBoardExpanded(true);
  }

  function exitOutfitMode(options?: { fromPopState?: boolean }) {
    if (
      Platform.OS === "web" &&
      boardHistoryPushedRef.current &&
      !options?.fromPopState
    ) {
      dismissBoardHistory();
    } else {
      boardHistoryPushedRef.current = false;
    }
    setBoardItems([]);
    setBoardExpanded(false);
    setOutfitMode(false);
    setOutfitForDate(null);
    setEditingOutfitId(null);
    setEditingDayOutfitId(null);
    setEditingSnapshot(null);
    boardDirtyRef.current = false;
  }

  function closeOutfitBoard() {
    // No layout edits on the board — return to the closet list as-is.
    if (!boardDirtyRef.current) {
      exitOutfitMode();
      return;
    }
    const isEditingExisting = editingOutfitId || editingDayOutfitId;
    Alert.alert(
      isEditingExisting ? "Discard changes?" : "Discard outfit?",
      isEditingExisting
        ? "The outfit will keep its last saved layout."
        : "Items on the board will be cleared.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => exitOutfitMode() },
      ],
    );
  }

  useEffect(() => {
    if (Platform.OS !== "web" || !boardExpanded) return;

    window.history.pushState({ outfitBoard: true }, "");
    boardHistoryPushedRef.current = true;

    const onPopState = () => {
      if (ignoreBoardPopRef.current) {
        ignoreBoardPopRef.current = false;
        return;
      }
      if (boardDirtyRef.current) {
        window.history.pushState({ outfitBoard: true }, "");
        boardHistoryPushedRef.current = true;
        closeOutfitBoard();
        return;
      }
      boardHistoryPushedRef.current = false;
      exitOutfitMode({ fromPopState: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [boardExpanded, editingOutfitId, editingDayOutfitId]);

  function removeBoardItem(id: string) {
    boardDirtyRef.current = true;
    setBoardItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleSaveOutfit(snapshot: OutfitBoardSnapshot) {
    if (savingOutfit) return;
    setSavingOutfit(true);
    try {
      if (editingDayOutfitId && outfitForDate) {
        const dateKey = outfitForDate;
        const itemIds = boardItems.map((i) => i.id);
        const wearableIds = itemIds.filter(
          (id) => itemsById.get(id)?.category !== DAILY_STACK_CATEGORY_NAME,
        );
        const originalIds = editingDayOutfitOriginalIdsRef.current;
        // Wears cap at one per item per day: items in another outfit on this
        // date already have their wear (skip +1) and keep it (skip -1).
        const wornElsewhere = await getWornItemIdsForDate(
          dateKey,
          editingDayOutfitId,
        );
        const added = wearableIds.filter(
          (id) => !originalIds.has(id) && !wornElsewhere.has(id),
        );
        const removed = [...originalIds].filter(
          (id) =>
            itemsById.get(id)?.category !== DAILY_STACK_CATEGORY_NAME &&
            !wearableIds.includes(id) &&
            !wornElsewhere.has(id),
        );
        await Promise.all([adjustWears(added, 1), adjustWears(removed, -1)]);
        await updateOutfitBoard(editingDayOutfitId, itemIds, {
          canvasW: snapshot.canvasW,
          canvasH: snapshot.canvasH,
          items: snapshot.items,
        });
        exitOutfitMode();
        router.push(`/day-outfits/${dateKey}`);
        return;
      }
      if (outfitForDate) {
        const dateKey = outfitForDate;
        const itemIds = boardItems.map((i) => i.id);
        const wearableIds = itemIds.filter(
          (id) => itemsById.get(id)?.category !== DAILY_STACK_CATEGORY_NAME,
        );
        const alreadyWorn = await getWornItemIdsForDate(dateKey);
        await adjustWears(
          wearableIds.filter((id) => !alreadyWorn.has(id)),
          1,
        );
        await saveOutfitItemsOnly(itemIds, dateKey, {
          canvasW: snapshot.canvasW,
          canvasH: snapshot.canvasH,
          items: snapshot.items,
        });
        exitOutfitMode();
        router.push(`/day-outfits/${dateKey}`);
        return;
      }
      if (editingOutfitId) {
        await updateSavedOutfit(editingOutfitId, snapshot);
        setSavedOutfits((prev) =>
          prev.map((o) =>
            o.id === editingOutfitId ? { ...o, ...snapshot } : o,
          ),
        );
      } else {
        const saved = await addSavedOutfit(snapshot);
        setSavedOutfits((prev) => [saved, ...prev]);
      }
      exitOutfitMode();
    } catch (e) {
      Alert.alert(
        "Could not save outfit",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setSavingOutfit(false);
    }
  }

  function openSavedOutfitForEdit(outfit: SavedOutfit) {
    if (outfitMode) return; // already building/editing an outfit
    const boardable = outfit.items
      .map((si) => itemsById.get(si.id))
      .filter((i): i is ClothingItem => i !== undefined);
    if (boardable.length === 0) {
      Alert.alert(
        "Nothing to edit",
        "The items in this outfit are no longer in your closet.",
      );
      return;
    }
    boardDirtyRef.current = false;
    setBoardItems(boardable);
    setEditingOutfitId(outfit.id);
    setEditingSnapshot({
      canvasW: outfit.canvasW,
      canvasH: outfit.canvasH,
      items: outfit.items,
    });
    setOutfitMode(true);
    setBoardExpanded(true);
  }

  // A board tapped on the outfit-boards page arrives as a param; open it in
  // the editor once the closet items and saved outfits have loaded.
  const { editOutfitId } = useLocalSearchParams<{ editOutfitId?: string }>();
  useEffect(() => {
    if (typeof editOutfitId !== "string" || !editOutfitId) return;
    if (items.length === 0) return; // wait for the closet to load
    const outfit = savedOutfits.find((o) => o.id === editOutfitId);
    if (!outfit) return;
    router.setParams({ editOutfitId: "" });
    openSavedOutfitForEdit(outfit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOutfitId, items, savedOutfits]);

  /** Loads a dated outfit's board by id and opens it in the editor, so saving
   *  updates that outfit row instead of inserting a new one. Fetches the
   *  closet fresh rather than relying on `items` state — this navigates in
   *  from another tab, so `items` may not have loaded (or synced) yet. */
  async function openDayOutfitForEdit(dateKey: string, dayOutfitId: string) {
    if (outfitMode) return; // already building/editing an outfit
    try {
      const [outfits, closetItems] = await Promise.all([
        getOutfitsForDate(dateKey),
        loadClosetFromSupabase(),
      ]);
      const outfit = outfits.find((o) => o.id === dayOutfitId);
      if (!outfit || !outfit.board) return;
      const freshById = new Map(closetItems.map((i) => [i.id, i]));
      const boardable = outfit.itemIds
        .map((id) => freshById.get(id))
        .filter((i): i is ClothingItem => i !== undefined);
      if (boardable.length === 0) {
        Alert.alert(
          "Nothing to edit",
          "The items in this outfit are no longer in your closet.",
        );
        return;
      }
      boardDirtyRef.current = false;
      editingDayOutfitOriginalIdsRef.current = new Set(outfit.itemIds);
      setItems(closetItems);
      setBoardItems(boardable);
      setEditingDayOutfitId(outfit.id);
      setEditingSnapshot({
        canvasW: outfit.board.canvasW,
        canvasH: outfit.board.canvasH,
        items: outfit.board.items,
      });
      setOutfitForDate(dateKey);
      setOutfitMode(true);
      setBoardExpanded(true);
    } catch (e) {
      Alert.alert(
        "Error",
        e instanceof Error ? e.message : "Could not load this outfit.",
      );
    }
  }

  // The "make outfit board" button on a day page arrives as a param; open a
  // blank board tagged with that date so saving writes a dated outfit.
  // Tapping an existing board on that day page instead adds editDayOutfitId,
  // which the effect below uses to load that outfit's board for editing.
  const {
    outfitForDate: outfitForDateParam,
    editDayOutfitId: editDayOutfitIdParam,
  } = useLocalSearchParams<{
    outfitForDate?: string;
    editDayOutfitId?: string;
  }>();
  useEffect(() => {
    if (typeof outfitForDateParam !== "string" || !outfitForDateParam) return;
    // When an editDayOutfitId also arrived, the effect below owns this
    // navigation — don't blank the board here.
    if (typeof editDayOutfitIdParam === "string" && editDayOutfitIdParam) return;
    router.setParams({ outfitForDate: "" });
    if (outfitMode) return; // already building/editing an outfit
    boardDirtyRef.current = false;
    setBoardItems([]);
    setEditingOutfitId(null);
    setEditingSnapshot(null);
    setOutfitForDate(outfitForDateParam);
    setOutfitMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfitForDateParam, editDayOutfitIdParam, outfitMode]);

  useEffect(() => {
    if (typeof editDayOutfitIdParam !== "string" || !editDayOutfitIdParam) return;
    if (typeof outfitForDateParam !== "string" || !outfitForDateParam) return;
    router.setParams({ outfitForDate: "", editDayOutfitId: "" });
    openDayOutfitForEdit(outfitForDateParam, editDayOutfitIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDayOutfitIdParam, outfitForDateParam]);

  const confirmDeleteSavedOutfit = useCallback((outfit: SavedOutfit) => {
    Alert.alert("Delete this outfit?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSavedOutfit(outfit.id);
            setSavedOutfits((prev) => prev.filter((o) => o.id !== outfit.id));
          } catch (e) {
            Alert.alert(
              "Could not delete outfit",
              e instanceof Error ? e.message : "Unknown error",
            );
          }
        },
      },
    ]);
  }, []);

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
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        saveToCameraRoll(result.assets[0].uri);
        // Straight into add-closet-item — no crop step first. Background
        // removal kicks off immediately there; cropping (if needed) happens
        // from the review screen afterward.
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
        // Crop each photo (free-form) before filling in item details.
        router.push({
          pathname: "/crop-image",
          params: {
            uris: JSON.stringify(result.assets.map((a) => a.uri)),
            returnTo: "add-new",
          },
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
  // Sized so ~3 cards are visible per row before scrolling horizontally, then
  // scaled to 2/3. On web the window can be arbitrarily wide, so use a fixed size.
  const cardWidth =
    Platform.OS === "web" ? 130 : ((windowWidth - 24 - 24) / 3) * (2 / 3);

  const listBottomPad = Math.max(32, insets.bottom + 80);

  function renderClosetCard(
    item: ClothingItem,
    extraStyle?: { marginTop?: number; marginBottom?: number },
    dragOpts?: { drag?: () => void; isActive?: boolean },
  ) {
    const outfitSelected = outfitMode && boardItemIds.has(item.id);
    return (
      <Pressable
        onPress={() =>
          outfitMode
            ? toggleOutfitSelected(item)
            : router.push(`/edit-closet-item?id=${item.id}`)
        }
        onLongPress={dragOpts?.drag}
        disabled={dragOpts?.isActive}
        style={({ pressed }) => [
          styles.cardPressable,
          { width: cardWidth },
          extraStyle,
          pressed && styles.cardPressed,
          dragOpts?.isActive && styles.cardDragging,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          outfitMode
            ? `${outfitSelected ? "Deselect" : "Select"} ${item.name} for outfit`
            : `Edit ${item.name}`
        }
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
            {metricDisplay && (
              <ThemedText numberOfLines={1} style={styles.itemBrand}>
                {formatMetric(item, metricDisplay)}
              </ThemedText>
            )}
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
        {outfitSelected && (
          <View pointerEvents="none" style={styles.cardOutfitSelectedOutline} />
        )}
      </Pressable>
    );
  }

  function toggleSectionExpanded(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderSection(
    section: CategorySection<ClothingItem>,
    opts?: { drag?: () => void; isActive?: boolean },
  ) {
    const isTwoRow = section.key === "top";
    const expanded = expandedSections.has(section.key);
    const sectionDrag =
      canReorderSections && opts?.drag && !opts.isActive ? opts.drag : undefined;
    const content = (
      <>
        <View style={styles.sectionHeaderRow}>
          <Pressable
            onLongPress={sectionDrag}
            disabled={!sectionDrag}
            accessibilityRole={sectionDrag ? "button" : "text"}
            accessibilityLabel={sectionDrag ? `Reorder ${section.label} category` : undefined}
          >
            <ThemedText style={styles.sectionTitle}>
              {section.label}{" "}
              <ThemedText style={styles.sectionCount}>
                {section.items.length}
              </ThemedText>
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => toggleSectionExpanded(section.key)}
            hitSlop={8}
            style={({ pressed }) => [styles.sectionSwirlBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={
              expanded
                ? `Collapse ${section.label} back to one row`
                : `Expand ${section.label} to show all items`
            }
          >
            <Swirl loosened={expanded} color="#000" />
          </Pressable>
        </View>
        {expanded ? (
          <View style={styles.sectionWrapGrid}>
            {section.items.map((item) => (
              <View key={item.id}>{renderClosetCard(item)}</View>
            ))}
          </View>
        ) : isTwoRow ? (
          canReorderItems ? (
            // Two-row sections drag by column pair — the draggable list is
            // one-dimensional, so the pair moves as a unit.
            <DraggableFlatList
              data={chunkPairs(section.items)}
              keyExtractor={(pair) => pair[0].id}
              horizontal
              activationDistance={8}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sectionRow}
              onDragEnd={({ data }) => handleItemsDragEnd(section.key, data.flat())}
              renderItem={({ item: pair, drag, isActive }: RenderItemParams<ClothingItem[]>) => (
                <View style={styles.columnPair}>
                  {renderClosetCard(pair[0], { marginBottom: 0 }, { drag, isActive })}
                  {pair[1] ? (
                    renderClosetCard(pair[1], { marginTop: 0 }, { drag, isActive })
                  ) : (
                    <View style={{ width: cardWidth }} />
                  )}
                </View>
              )}
            />
          ) : (
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
          )
        ) : canReorderItems ? (
          <DraggableFlatList
            data={section.items}
            keyExtractor={(item) => item.id}
            horizontal
            activationDistance={8}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionRow}
            onDragEnd={({ data }) => handleItemsDragEnd(section.key, data)}
            renderItem={({ item, drag, isActive }: RenderItemParams<ClothingItem>) =>
              renderClosetCard(item, undefined, { drag, isActive })
            }
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
      </>
    );
    const containerStyle = [
      styles.sectionContainer,
      opts?.isActive && styles.sectionContainerActive,
    ];
    // Holding anywhere in the section that isn't a card (cards claim their own
    // touches) starts the section drag — not just the title.
    return sectionDrag ? (
      <Pressable onLongPress={sectionDrag} accessible={false} style={containerStyle}>
        {content}
      </Pressable>
    ) : (
      <View style={containerStyle}>{content}</View>
    );
  }

  // DraggableFlatList breaks scrolling on web (its pan gesture wrapper
  // swallows the scroll), so render a plain FlatList there. Long-press
  // drag-to-reorder is a native-only affordance anyway.
  const listHeader = (
    <View style={styles.searchHeader}>
                {outfitMode && outfitForDate && (
                  <ThemedText type="defaultSemiBold" style={styles.outfitForDateBanner}>
                    outfit for {formatOutfitDateLabel(outfitForDate)}
                  </ThemedText>
                )}
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
                  {!categoriesButtonHidden && (
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
                  )}
                  {!metricButtonHidden && (
                    <Pressable
                      onPress={() => setShowMetricSheet(true)}
                      style={({ pressed }) => [
                        styles.sortBtn,
                        { borderColor, backgroundColor: inputBackground },
                        pressed && { opacity: 0.7 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Choose which metric to show"
                    >
                      <Ionicons name="stats-chart-outline" size={18} color={textColor} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => router.push("/outfit-boards")}
                    style={({ pressed }) => [
                      styles.sortBtn,
                      { borderColor, backgroundColor: inputBackground },
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Outfit boards"
                  >
                    <Ionicons name="albums-outline" size={18} color={textColor} />
                  </Pressable>
                </View>
      {loadError ? (
        <ThemedText style={styles.errorBanner}>
          {loadError}
        </ThemedText>
      ) : null}
    </View>
  );

  const addCategoryFooter = footerAdding ? (
    <View style={[styles.addCategoryFooter, styles.addCategoryRowContent]}>
      <TextInput
        ref={footerInputRef}
        accessibilityLabel="New category name"
        placeholder="New category name"
        placeholderTextColor={placeholderColor}
        value={footerCategoryName}
        onChangeText={setFooterCategoryName}
        onSubmitEditing={handleFooterAddCategory}
        editable={!savingCategory}
        style={[
          styles.addCategoryInput,
          { borderColor, color: textColor, backgroundColor: inputBackground },
        ]}
      />
      <Pressable
        onPress={cancelFooterAddCategory}
        hitSlop={8}
        style={styles.addCategoryFooterCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel adding category"
      >
        <Ionicons name="close" size={22} color={textColor} />
      </Pressable>
      <Pressable
        onPress={handleFooterAddCategory}
        disabled={savingCategory || !footerCategoryName.trim()}
        style={({ pressed }) => [
          styles.addCategoryBtn,
          (savingCategory || !footerCategoryName.trim()) && styles.fabDisabled,
          pressed && { opacity: 0.8 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Save category"
      >
        {savingCategory ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="checkmark" size={20} color="#fff" />
        )}
      </Pressable>
    </View>
  ) : (
    <Pressable
      onPress={() => setFooterAdding(true)}
      style={({ pressed }) => [
        styles.addCategoryFooterBtn,
        { borderColor },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Add category"
    >
      <Ionicons name="add" size={18} color={textColor} />
      <ThemedText style={styles.addCategoryFooterText}>Add category</ThemedText>
    </Pressable>
  );

  const itemsById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  const boardItemIds = useMemo(
    () => new Set(boardItems.map((i) => i.id)),
    [boardItems],
  );

  function renderSavedOutfitCard(outfit: SavedOutfit) {
    const cardW = 150;
    const cardH = 190;
    const f = Math.min(
      cardW / Math.max(outfit.canvasW, 1),
      cardH / Math.max(outfit.canvasH, 1),
    );
    return (
      <View style={styles.savedOutfitCell}>
      <Pressable
        onPress={() => openSavedOutfitForEdit(outfit)}
        onLongPress={() => confirmDeleteSavedOutfit(outfit)}
        style={({ pressed }) => [
          styles.savedOutfitCard,
          { width: cardW, height: cardH, borderColor },
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Saved outfit. Tap to edit, long-press to delete."
      >
        {outfit.items.map((si) => {
          const item = itemsById.get(si.id);
          if (!item) return null; // item since removed from closet
          return (
            <View
              key={si.id}
              style={{
                position: "absolute",
                left: si.x * f,
                top: si.y * f,
                width: OUTFIT_ITEM_W * f,
                height: OUTFIT_ITEM_H * f,
                zIndex: si.z,
                transform: [{ scale: si.scale }],
              }}
            >
              <Image
                source={item.image}
                style={styles.savedOutfitItemImage}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            </View>
          );
        })}
      </Pressable>
      <ThemedText style={styles.savedOutfitDate}>
        {formatBoardDate(outfit.createdAt)}
      </ThemedText>
      </View>
    );
  }

  const savedOutfitsSection =
    savedOutfits.length > 0 ? (
      <View style={styles.savedOutfitsSection}>
        <ThemedText style={styles.sectionTitle}>
          Outfits{" "}
          <ThemedText style={styles.sectionCount}>
            {savedOutfits.length}
          </ThemedText>
        </ThemedText>
        <FlatList
          data={savedOutfits}
          keyExtractor={(o) => o.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sectionRow}
          renderItem={({ item: outfit }) => renderSavedOutfitCard(outfit)}
        />
      </View>
    ) : null;

  const listEmpty =
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
    );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator style={styles.loading} size="large" />
        ) : Platform.OS === "web" ? (
          <FlatList
            data={sections}
            keyExtractor={(section) => section.key}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.sectionDivider} />}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: listBottomPad },
            ]}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={
              <>
                {addCategoryFooter}
                {savedOutfitsSection}
              </>
            }
            renderItem={({ item: section }) => renderSection(section)}
          />
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
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            renderItem={({ item: section, drag, isActive }) =>
              renderSection(section, { drag, isActive })
            }
            ListFooterComponent={
              <>
                {uncategorizedSection && (
                  <>
                    {draggableSections.length > 0 && (
                      <View style={styles.sectionDivider} />
                    )}
                    {renderSection(uncategorizedSection)}
                  </>
                )}
                {addCategoryFooter}
                {savedOutfitsSection}
              </>
            }
          />
        )}
        {outfitMode ? (
          !boardExpanded && (
            <Pressable
              onPress={handleDoneSelecting}
              style={({ pressed }) => [
                styles.doneSelectingBtn,
                { bottom: insets.bottom + 10, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                boardItems.length > 0
                  ? "Done selecting, open outfit board"
                  : "Cancel making outfit"
              }
            >
              <ThemedText style={styles.doneSelectingText}>
                {boardItems.length > 0 ? "done selecting" : "cancel"}
              </ThemedText>
            </Pressable>
          )
        ) : fabOpen ? (
          <>
            <Pressable
              onPress={() => setFabOpen(false)}
              style={styles.fabScrim}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            />
            <View
              style={[styles.fabMenu, { bottom: insets.bottom + 76, right: 16 }]}
            >
              <Pressable
                onPress={() => {
                  setFabOpen(false);
                  setOutfitMode(true);
                }}
                style={({ pressed }) => [
                  styles.fabMenuItem,
                  pressed && styles.fabPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Make an outfit"
              >
                <Ionicons name="shirt-outline" size={18} color="#000" />
                <ThemedText style={styles.fabMenuLabel}>make outfit</ThemedText>
              </Pressable>
              {hasGmailAccess && (
                <Pressable
                  onPress={syncGmail}
                  disabled={syncing}
                  style={({ pressed }) => [
                    styles.fabMenuItem,
                    pressed && styles.fabPressed,
                    syncing && styles.fabDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Sync Gmail"
                >
                  {syncing ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="mail-outline" size={18} color="#000" />
                      <ThemedText style={styles.fabMenuLabel}>
                        sync gmail
                      </ThemedText>
                    </>
                  )}
                </Pressable>
              )}
              <PasteImageButton
                size={{ width: 116, height: 48 }}
                style={styles.fabMenuShadow}
                backgroundColor="#fff"
                foregroundColor="#000"
                onBeforePaste={() => setFabOpen(false)}
                onImage={openAddItemWithClipboardImage}
              >
                <Ionicons name="clipboard-outline" size={18} color="#000" />
                <ThemedText style={styles.fabMenuLabel}>paste</ThemedText>
              </PasteImageButton>
              <Pressable
                onPress={() => {
                  setFabOpen(false);
                  router.push("/web-capture");
                }}
                style={({ pressed }) => [
                  styles.fabMenuItem,
                  pressed && styles.fabPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Capture item from the web"
              >
                <Ionicons name="globe-outline" size={18} color="#000" />
                <ThemedText style={styles.fabMenuLabel}>from web</ThemedText>
              </Pressable>
              <Pressable
                onPress={addFromLibrary}
                style={({ pressed }) => [
                  styles.fabMenuItem,
                  pressed && styles.fabPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add items from library"
              >
                <Ionicons name="images-outline" size={18} color="#000" />
                <ThemedText style={styles.fabMenuLabel}>library</ThemedText>
              </Pressable>
              <Pressable
                onPress={addFromCamera}
                style={({ pressed }) => [
                  styles.fabMenuItem,
                  pressed && styles.fabPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add items with camera"
              >
                <Ionicons name="camera-outline" size={18} color="#000" />
                <ThemedText style={styles.fabMenuLabel}>camera</ThemedText>
              </Pressable>
            </View>
            <Pressable
              onPress={() => setFabOpen(false)}
              style={({ pressed }) => [
                styles.fab,
                { bottom: insets.bottom + 4, right: 16 },
                pressed && styles.fabPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => setFabOpen(true)}
            style={({ pressed }) => [
              styles.fab,
              { bottom: insets.bottom + 4, right: 16 },
              pressed && styles.fabPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Actions"
          >
            <Ionicons name="add" size={30} color="#fff" />
          </Pressable>
        )}
        {outfitMode && (
          <OutfitBoard
            items={boardItems}
            expanded={boardExpanded}
            onExpand={() => setBoardExpanded(true)}
            onMinimize={() => {
              dismissBoardHistory();
              setBoardExpanded(false);
            }}
            onRemoveItem={removeBoardItem}
            onClose={closeOutfitBoard}
            onSave={handleSaveOutfit}
            saving={savingOutfit}
            onDirty={markBoardDirty}
            initialSnapshot={editingSnapshot}
            bottomOffset={insets.bottom + 10}
            title={
              outfitForDate
                ? `outfit for ${formatOutfitDateLabel(outfitForDate)}`
                : undefined
            }
          />
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

      <Modal
        visible={showMetricSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMetricSheet(false)}
      >
        <Pressable
          style={styles.sheetOverlay}
          onPress={() => setShowMetricSheet(false)}
        >
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <ThemedText type="defaultSemiBold" style={styles.sheetTitle}>
              Show under each item
            </ThemedText>
            {METRIC_OPTIONS.map(({ key, label }) => {
              const active = metricDisplay === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => { setMetricDisplay(active ? null : key); setShowMetricSheet(false); }}
                  style={[styles.sheetOption, active && styles.sheetOptionActive]}
                >
                  <ThemedText style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>
                    {label}
                  </ThemedText>
                  {active && <Ionicons name="checkmark" size={18} color="#fff" />}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setShowMetricSheet(false)}
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
              {!addingCategory && (
                <Pressable
                  onPress={() => setAddingCategory(true)}
                  hitSlop={8}
                  style={styles.sheetTitleAddBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Add category"
                >
                  <Ionicons name="add" size={22} color={textColor} />
                </Pressable>
              )}
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
                  onPress={cancelAddCategory}
                  hitSlop={8}
                  style={styles.addCategoryFooterCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel adding category"
                >
                  <Ionicons name="close" size={22} color={textColor} />
                </Pressable>
                <Pressable
                  onPress={handleAddCategory}
                  disabled={savingCategory || !newCategoryName.trim()}
                  style={({ pressed }) => [
                    styles.addCategoryBtn,
                    (savingCategory || !newCategoryName.trim()) && styles.fabDisabled,
                    pressed && { opacity: 0.8 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save category"
                >
                  {savingCategory ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark" size={20} color="#fff" />
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
  outfitForDateBanner: {
    fontSize: 17,
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
  addCategoryFooter: {
    marginTop: 16,
  },
  addCategoryFooterBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addCategoryFooterText: {
    fontSize: 15,
    fontWeight: "600",
  },
  addCategoryFooterCancel: {
    padding: 4,
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
    borderRadius: 30,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  fabDisabled: {
    opacity: 0.45,
  },
  fabMenu: {
    position: "absolute",
    alignItems: "flex-end",
    gap: 12,
    zIndex: 1,
  },
  fabMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabMenuShadow: {
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabMenuLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000",
  },
  fabScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.2)",
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
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionSwirlBtn: {
    padding: 2,
    marginRight: 4,
  },
  sectionWrapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  cardDragging: {
    opacity: 0.85,
    transform: [{ scale: 1.05 }],
  },
  cardOutfitSelectedOutline: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 12,
    zIndex: 1,
  },
  doneSelectingBtn: {
    position: "absolute",
    height: 48,
    paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  doneSelectingText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  savedOutfitsSection: {
    marginTop: 20,
  },
  savedOutfitCell: {
    marginRight: 8,
    marginVertical: 4,
  },
  savedOutfitCard: {
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  savedOutfitDate: {
    fontSize: 11,
    opacity: 0.55,
    textAlign: "center",
    marginTop: 4,
  },
  savedOutfitItemImage: {
    width: "100%",
    height: "100%",
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
