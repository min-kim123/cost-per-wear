import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  type DayOutfit,
  deleteOutfit,
  getOutfitsForDate,
} from "@/lib/outfit-storage";
import { getWeatherMap } from "@/lib/weather";
import { getSupabase } from "@/supabase-client";

type ItemData = {
  name: string;
  image: string | null;
};

async function loadItemData(): Promise<Record<string, ItemData>> {
  const { data } = await getSupabase()
    .from("closet")
    .select("id, brand, name, image");
  const map: Record<string, ItemData> = {};
  for (const row of data ?? []) {
    const brand = ((row.brand as string | null) ?? "").trim();
    const name = (row.name as string) ?? "";
    map[row.id as string] = {
      name: brand ? `${brand} · ${name}` : name,
      image: (row.image as string | null) ?? null,
    };
  }
  return map;
}

export default function DayOutfitsScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateKey = typeof date === "string" ? date : "";
  const [list, setList] = useState<DayOutfit[]>([]);
  const [itemData, setItemData] = useState<Record<string, ItemData>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [maxTemp, setMaxTemp] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!dateKey) return;
    const [rows, data] = await Promise.all([
      getOutfitsForDate(dateKey),
      loadItemData(),
    ]);
    setList(rows);
    setItemData(data);
    return rows;
  }, [dateKey]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!dateKey) return;
      Promise.all([getOutfitsForDate(dateKey), loadItemData()]).then(
        ([rows, data]) => {
          if (active) {
            setList(rows);
            setItemData(data);
          }
        },
      );
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
              const updated = list.filter((o) => o.id !== outfit.id);
              if (updated.length === 0) {
                router.back();
              } else {
                setList(updated);
                // Best-effort background refresh to sync item metadata.
                refresh().catch(() => {});
              }
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

  return (
    <>
      <Stack.Screen options={{ title: dateKey }} />
      <ThemedView style={styles.container}>
        <View style={styles.subtitleRow}>
          <ThemedText style={styles.subtitle}>
            {list.length} outfit{list.length === 1 ? "" : "s"} this day
          </ThemedText>
          {maxTemp !== null && (
            <ThemedText style={styles.tempBadge}>🌡 {maxTemp}°F</ThemedText>
          )}
        </View>
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => {
            const itemsWithData = item.itemIds.map((id) => ({
              id,
              ...(itemData[id] ?? { name: id, image: null }),
            }));

            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <ThemedText type="defaultSemiBold" style={styles.cardTitle}>
                    Outfit {index + 1}
                  </ThemedText>
                  <Pressable
                    onPress={() => confirmDelete(item)}
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
                ) : itemsWithData.length > 0 ? (
                  <View style={styles.itemGrid}>
                    {itemsWithData.map(({ id, name, image }) => (
                      <View key={id} style={styles.itemGridThumb}>
                        {image ? (
                          <Image
                            source={{ uri: image }}
                            style={styles.itemGridImage}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.itemThumbPlaceholder}>
                            <Ionicons
                              name="shirt-outline"
                              size={24}
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
              </View>
            );
          }}
          ListEmptyComponent={
            <ThemedText style={styles.muted}>
              No outfits saved for this day.
            </ThemedText>
          }
        />

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
  deleteBtn: {
    padding: 6,
  },
  photo: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.2)",
  },
  itemsLabel: {
    fontWeight: "600",
    marginTop: 4,
  },
  itemGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 4,
  },
  itemGridThumb: {
    width: "22%",
    alignItems: "center",
    gap: 4,
  },
  itemGridImage: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
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
