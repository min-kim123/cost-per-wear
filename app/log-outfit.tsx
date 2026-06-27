import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
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
import { saveOutfitItemsOnly, getTodayDateKey } from "@/lib/outfit-storage";
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
  const { date } = useLocalSearchParams<{ date?: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const [items, setItems] = useState<ClosetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const textColor = useThemeColor({}, "text");
  const cardBackground = useThemeColor(
    { light: "#ffffff", dark: "#1c1c1e" },
    "background",
  );

  const cardWidth = (windowWidth - 24 - 24) / 3;

  useEffect(() => {
    loadItems()
      .then(setItems)
      .catch((e) =>
        Alert.alert("Error", e instanceof Error ? e.message : "Could not load closet"),
      )
      .finally(() => setLoading(false));
  }, []);

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (selectedIds.size === 0) {
      Alert.alert("No items selected", "Tap items you wore today.");
      return;
    }
    setSaving(true);
    try {
      const targetDate = typeof date === "string" && date ? date : undefined;
      await saveOutfitItemsOnly(Array.from(selectedIds), targetDate);
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
        }}
      />

      <ThemedText style={styles.subtitle}>
        {dateKey} · {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
      </ThemedText>

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
