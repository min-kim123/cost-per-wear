import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
  saveOutfitItemsOnly,
  saveOutfitWithPhoto,
  updateOutfit,
  getOutfitsForDate,
  getTodayDateKey,
} from "@/lib/outfit-storage";
import { getSupabase } from "@/supabase-client";

type ClosetItem = {
  id: string;
  brand: string;
  name: string;
  imageUri: string | null;
};

async function loadItems(): Promise<ClosetItem[]> {
  const { data, error } = await getSupabase()
    .from("closet")
    .select("id, brand, name, image")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    brand: (row.brand as string | null) ?? "",
    name: row.name as string,
    imageUri: (row.image as string | null) ?? null,
  }));
}

export default function LogOutfitScreen() {
  const router = useRouter();
  const { date, outfitId } = useLocalSearchParams<{ date?: string; outfitId?: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const isEditing = typeof outfitId === "string" && outfitId.length > 0;

  const [items, setItems] = useState<ClosetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [outfitPhotoUri, setOutfitPhotoUri] = useState<string | null>(null);
  const [originalPhotoUri, setOriginalPhotoUri] = useState<string>("");
  const [picking, setPicking] = useState(false);

  const textColor = useThemeColor({}, "text");
  const cardBackground = useThemeColor(
    { light: "#ffffff", dark: "#1c1c1e" },
    "background",
  );
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#F2F2F7" }, "background");

  const cardWidth = (windowWidth - 24 - 24) / 3;

  useEffect(() => {
    const dateKey = typeof date === "string" && date ? date : getTodayDateKey();
    const promises: Promise<void>[] = [
      loadItems()
        .then(setItems)
        .catch((e) =>
          Alert.alert("Error", e instanceof Error ? e.message : "Could not load closet"),
        ),
    ];
    // If editing, pre-populate state from stored outfit
    if (isEditing) {
      promises.push(
        getOutfitsForDate(dateKey).then((outfits) => {
          const outfit = outfits.find((o) => o.id === outfitId);
          if (outfit) {
            setSelectedIds(new Set(outfit.itemIds));
            const uri = outfit.photoUri || null;
            setOutfitPhotoUri(uri);
            setOriginalPhotoUri(outfit.photoUri ?? "");
          }
        }).catch(() => {}),
      );
    }
    Promise.all(promises).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not pick photo.");
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    if (selectedIds.size === 0) {
      Alert.alert("No items selected", "Tap items you wore today.");
      return;
    }
    setSaving(true);
    try {
      const targetDate = typeof date === "string" && date ? date : undefined;
      if (outfitPhotoUri) {
        await saveOutfitWithPhoto(Array.from(selectedIds), outfitPhotoUri, targetDate);
      } else {
        await saveOutfitItemsOnly(Array.from(selectedIds), targetDate);
      }
      router.back();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not save outfit");
    } finally {
      setSaving(false);
    }
  }

  const dateKey = typeof date === "string" && date ? date : getTodayDateKey();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: typeof date === "string" && date ? `Outfit for ${date}` : "Today's Outfit",
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
        {dateKey} · {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
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
              onPress={() => setOutfitPhotoUri(null)}
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

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + 20 },
          ]}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <Pressable
                onPress={() => toggleItem(item.id)}
                style={({ pressed }) => [
                  styles.cardPressable,
                  { width: cardWidth },
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="checkbox"
                accessibilityLabel={item.name}
                accessibilityState={{ checked: isSelected }}
              >
                <ThemedView
                  style={[styles.card, isSelected && styles.cardSelected]}
                >
                  {item.imageUri ? (
                    <Image
                      source={{ uri: item.imageUri }}
                      style={styles.image}
                      contentFit="cover"
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
                        <Ionicons
                          name="checkmark-circle"
                          size={28}
                          color="#fff"
                        />
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
                  </View>
                </ThemedView>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              No items in your closet yet.
            </ThemedText>
          }
        />
      )}

      {selectedIds.size > 0 && (
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
                Save outfit ({selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""})
              </ThemedText>
            )}
          </Pressable>
        </View>
      )}
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
});
