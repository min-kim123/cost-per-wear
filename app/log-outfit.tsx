import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  adjustWears,
  getOutfitsForDate,
  getWornItemIdsForDate,
  saveOutfitItemsOnly,
  saveOutfitWithPhoto,
  updateOutfit,
  getTodayDateKey,
} from "@/lib/outfit-storage";
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

function parseItemIdsParam(param: string | string[] | undefined): string[] {
  if (!param) return [];
  const raw = Array.isArray(param) ? param.join(",") : param;
  return raw.split(",").filter(Boolean);
}

async function loadItems(): Promise<ClosetItem[]> {
  const { data, error } = await getSupabase()
    .from("closet")
    .select("id, brand, name, image, cost, wears, category")
    .order("position", { ascending: true, nullsFirst: true })
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
    return {
      id: String(row.id),
      brand: (row.brand as string | null) ?? "",
      name: row.name as string,
      imageUri: (row.image as string | null) ?? null,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
      wears: typeof row.wears === "number" && row.wears >= 0 ? row.wears : 0,
      category: (row.category as string | null) ?? null,
    };
  });
}

export default function LogOutfitScreen() {
  const router = useRouter();
  const { date, outfitId, itemIds: itemIdsParam, photoUri: photoUriParam } =
    useLocalSearchParams<{ date?: string; outfitId?: string; itemIds?: string; photoUri?: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const isEditing = typeof outfitId === "string" && outfitId.length > 0;

  const [items, setItems] = useState<ClosetItem[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const initialSelectedIdsRef = useRef<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [outfitPhotoUri, setOutfitPhotoUri] = useState<string | null>(null);
  const [originalPhotoUri, setOriginalPhotoUri] = useState<string>("");
  // Only a fresh in-app camera capture should land in the camera roll — never
  // a library pick, and never the existing remote photo loaded for editing.
  const [photoFromCamera, setPhotoFromCamera] = useState(false);
  const [picking, setPicking] = useState(false);
  const [loadingOutfit, setLoadingOutfit] = useState(isEditing);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#F2F2F7" }, "background");

  const cardWidth = (windowWidth - 24 - 24) / 3;

  const dateKey = typeof date === "string" && date ? date : getTodayDateKey();

  // Load existing outfit when editing (Supabase is source of truth; URL params are fallback)
  useEffect(() => {
    if (!isEditing || typeof outfitId !== "string") {
      setLoadingOutfit(false);
      return;
    }

    let cancelled = false;
    setLoadingOutfit(true);

    (async () => {
      try {
        const outfits = await getOutfitsForDate(dateKey);
        const outfit = outfits.find((o) => o.id === outfitId);
        if (cancelled) return;

        if (outfit) {
          const ids = outfit.itemIds;
          const idSet = new Set(ids);
          initialSelectedIdsRef.current = idSet;
          setSelectedIds(idSet);
          setOutfitPhotoUri(outfit.photoUri || null);
          setOriginalPhotoUri(outfit.photoUri ?? "");
          return;
        }
      } catch {
        // fall through to URL params
      }

      if (cancelled) return;
      const fromParams = parseItemIdsParam(itemIdsParam);
      if (fromParams.length > 0) {
        const idSet = new Set(fromParams);
        initialSelectedIdsRef.current = idSet;
        setSelectedIds(idSet);
      }
      const photo =
        typeof photoUriParam === "string" ? photoUriParam : "";
      if (photo) {
        setOutfitPhotoUri(photo);
        setOriginalPhotoUri(photo);
      }
    })().finally(() => {
      if (!cancelled) setLoadingOutfit(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isEditing, outfitId, dateKey, itemIdsParam, photoUriParam]);

  useFocusEffect(
    useCallback(() => {
      loadItems()
        .then(setItems)
        .catch((e) =>
          Alert.alert("Error", e instanceof Error ? e.message : "Could not load closet"),
        )
        .finally(() => setLoading(false));
      listCategories()
        .then(setCategories)
        .catch(() => setCategories([]));
    }, []),
  );

  // Daily Stack items accrue wears automatically and are auto-appended to every
  // outfit at save time — they aren't manually toggleable here.
  const dailyStackItemIds = useMemo(
    () => items.filter((i) => i.category === DAILY_STACK_CATEGORY_NAME).map((i) => i.id),
    [items],
  );
  const dailyStackIdSet = useMemo(() => new Set(dailyStackItemIds), [dailyStackItemIds]);

  const pickableItems = useMemo(
    () => items.filter((i) => !dailyStackIdSet.has(i.id)),
    [items, dailyStackIdSet],
  );

  const visibleSelectedIds = useMemo(
    () => Array.from(selectedIds).filter((id) => !dailyStackIdSet.has(id)),
    [selectedIds, dailyStackIdSet],
  );

  const sections = useMemo(
    () => groupByCategory(pickableItems, categories),
    [pickableItems, categories],
  );

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pickPhoto(mode: "camera" | "library") {
    if (picking || saving) return;
    setPicking(true);
    try {
      let result: ImagePicker.ImagePickerResult;
      if (mode === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Camera access", "Allow camera access in Settings.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.85, aspect: [3, 4], allowsEditing: true });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Photo library", "Allow photo library access in Settings.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, aspect: [3, 4], allowsEditing: true });
      }
      if (!result.canceled && result.assets[0]?.uri) {
        setOutfitPhotoUri(result.assets[0].uri);
        setPhotoFromCamera(mode === "camera");
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not pick photo.");
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    if (visibleSelectedIds.length === 0) {
      Alert.alert("No items selected", "Tap items you wore today.");
      return;
    }
    setSaving(true);
    try {
      const targetDate = typeof date === "string" && date ? date : undefined;
      const newIds = visibleSelectedIds;
      // Daily Stack items are always part of the outfit, appended at the end.
      const finalIds = [...newIds, ...dailyStackItemIds];

      if (isEditing) {
        const originalIds = initialSelectedIdsRef.current;
        // Wears cap at one per item per day: items in another outfit on this
        // date already have their wear (skip +1) and keep it (skip -1).
        const wornElsewhere = await getWornItemIdsForDate(
          dateKey,
          outfitId as string,
        );
        const added = newIds.filter(
          (id) => !originalIds.has(id) && !wornElsewhere.has(id),
        );
        const removed = [...originalIds].filter(
          (id) =>
            !dailyStackIdSet.has(id) &&
            !newIds.includes(id) &&
            !wornElsewhere.has(id),
        );
        await Promise.all([
          adjustWears(added, 1),
          adjustWears(removed, -1),
        ]);
        await updateOutfit(
          dateKey,
          outfitId as string,
          finalIds,
          outfitPhotoUri,
          originalPhotoUri,
          { skipCameraRoll: !photoFromCamera },
        );
      } else {
        const alreadyWorn = await getWornItemIdsForDate(
          targetDate ?? getTodayDateKey(),
        );
        await adjustWears(
          newIds.filter((id) => !alreadyWorn.has(id)),
          1,
        );
        if (outfitPhotoUri) {
          await saveOutfitWithPhoto(finalIds, outfitPhotoUri, targetDate, {
            skipCameraRoll: !photoFromCamera,
          });
        } else {
          await saveOutfitItemsOnly(finalIds, targetDate);
        }
      }
      router.back();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not save outfit");
    } finally {
      setSaving(false);
    }
  }

  const selectedKey = Array.from(selectedIds).sort().join(",");

  function renderItemCard(item: ClosetItem, extraStyle?: { marginTop?: number; marginBottom?: number }) {
    const isSelected = selectedIds.has(item.id);
    const cpw = item.cost / Math.max(item.wears, 1);
    return (
      <Pressable
        onPress={() => toggleItem(item.id)}
        style={({ pressed }) => [
          styles.cardPressable,
          { width: cardWidth },
          extraStyle,
          pressed && { opacity: 0.75 },
        ]}
        accessibilityRole="checkbox"
        accessibilityLabel={item.name}
        accessibilityState={{ checked: isSelected }}
      >
        <ThemedView style={[styles.card, isSelected && styles.cardSelected]}>
          {item.imageUri ? (
            <Image
              source={{ uri: item.imageUri }}
              style={styles.image}
              contentFit="contain"
            />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]}>
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
                <Ionicons name="checkmark-circle" size={28} color="#fff" />
              </View>
            </>
          )}

          <View style={styles.cardLabel}>
            <ThemedText numberOfLines={1} style={styles.itemBrand}>
              {item.brand || " "}
            </ThemedText>
            <ThemedText numberOfLines={1} style={styles.itemName}>
              {item.name}
            </ThemedText>
            <ThemedText style={styles.itemCpw}>
              ${cpw.toFixed(2)}/wear
            </ThemedText>
            <ThemedText style={styles.itemCost}>
              ${item.cost.toFixed(0)} total
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: isEditing
            ? "Edit outfit"
            : typeof date === "string" && date
              ? `Outfit for ${date}`
              : "Today's Outfit",
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, paddingRight: 8 }]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={26} color="#000" />
            </Pressable>
          ),
        }}
      />

      <ThemedText style={styles.subtitle}>
        {dateKey} · {visibleSelectedIds.length} item{visibleSelectedIds.length !== 1 ? "s" : ""} selected
      </ThemedText>

      {/* Optional outfit photo */}
      <View style={[styles.photoRow, { borderColor }]}>
        {outfitPhotoUri ? (
          <View style={styles.photoPreviewWrap}>
            <Image
              source={{ uri: outfitPhotoUri }}
              style={styles.photoPreview}
              contentFit="cover"
            />
            <Pressable
              onPress={() => {
                setOutfitPhotoUri(null);
                setPhotoFromCamera(false);
              }}
              style={styles.photoRemoveBtn}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="image-outline" size={28} color={placeholderColor} />
            <ThemedText style={styles.photoPlaceholderText}>Outfit photo (optional)</ThemedText>
          </View>
        )}
        <View style={styles.photoActions}>
          <Pressable
            onPress={() => pickPhoto("camera")}
            disabled={picking || saving}
            style={({ pressed }) => [
              styles.photoBtn,
              { borderColor, backgroundColor: inputBackground },
              (picking || saving) && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityLabel="Take outfit photo"
          >
            <Ionicons name="camera-outline" size={20} color={textColor} />
          </Pressable>
          <Pressable
            onPress={() => pickPhoto("library")}
            disabled={picking || saving}
            style={({ pressed }) => [
              styles.photoBtn,
              { borderColor, backgroundColor: inputBackground },
              (picking || saving) && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityLabel="Choose outfit photo from library"
          >
            <Ionicons name="images-outline" size={20} color={textColor} />
          </Pressable>
        </View>
      </View>

      {loading || loadingOutfit ? (
        <ActivityIndicator style={styles.loader} size="large" />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(section) => section.key}
          extraData={selectedKey}
          ItemSeparatorComponent={() => <View style={styles.sectionDivider} />}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + 20 },
          ]}
          renderItem={({ item: section }) => {
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
          }}
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              No items in your closet yet.
            </ThemedText>
          }
        />
      )}

      {visibleSelectedIds.length > 0 && (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + 12 },
          ]}
        >
          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && { opacity: 0.85 },
              saving && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save outfit"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.saveBtnText} lightColor="#fff" darkColor="#fff">
                {isEditing
                  ? "Save changes"
                  : `Save outfit (${visibleSelectedIds.length} item${visibleSelectedIds.length !== 1 ? "s" : ""})`}
              </ThemedText>
            )}
          </Pressable>
        </View>
      )}

      {/* FAB to add a new closet item without leaving the outfit flow */}
      <Pressable
        onPress={() => router.push("/add-closet-item")}
        style={({ pressed }) => [
          styles.addItemFab,
          { bottom: insets.bottom + (visibleSelectedIds.length > 0 ? 88 : 20) },
          pressed && { opacity: 0.8 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add new closet item"
      >
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  subtitle: {
    fontSize: 13,
    opacity: 0.55,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  loader: { marginTop: 48 },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  photoPreviewWrap: {
    width: 72,
    height: 96,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  photoRemoveBtn: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 11,
  },
  photoPlaceholder: {
    width: 72,
    height: 96,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.1)",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  photoPlaceholderText: {
    fontSize: 9,
    opacity: 0.5,
    textAlign: "center",
  },
  photoActions: {
    flexDirection: "column",
    gap: 8,
  },
  photoBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    paddingHorizontal: 12,
    paddingTop: 8,
    flexGrow: 1,
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
  cardPressable: { margin: 4 },
  card: {
    borderRadius: 12,
    overflow: "hidden",
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
    zIndex: 4,
    backgroundColor: "rgba(10,126,164,0.75)",
    borderRadius: 14,
  },
  image: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 12,
  },
  imagePlaceholder: {
    backgroundColor: "rgba(128,128,128,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardLabel: {
    paddingHorizontal: 4,
    paddingVertical: 5,
    gap: 1,
  },
  itemBrand: {
    fontSize: 10,
    opacity: 0.55,
    textAlign: "center",
  },
  itemName: {
    fontSize: 12,
    textAlign: "center",
  },
  itemCpw: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 1,
  },
  itemCost: {
    fontSize: 10,
    opacity: 0.45,
    textAlign: "center",
  },
  empty: {
    textAlign: "center",
    marginTop: 40,
    opacity: 0.6,
  },
  saveLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  saveLabelDisabled: {
    opacity: 0.35,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.2)",
  },
  saveBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  addItemFab: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
});
