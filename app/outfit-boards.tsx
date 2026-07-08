import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { OUTFIT_ITEM_H, OUTFIT_ITEM_W } from "@/components/outfit-board";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTabFocusEffect, useTabNavigation } from "@/lib/tab-navigation";
import {
  deleteSavedOutfit,
  formatBoardDate,
  listSavedOutfits,
  type SavedOutfit,
} from "@/lib/saved-outfits";
import { getSupabase } from "@/lib/supabase-client";

const PAGE_PAD = 16;
const GRID_GAP = 12;

// Gallery of every saved outfit board. Tapping a board hands it to the closet
// screen for editing (the board editor lives there); long-press deletes.
export default function OutfitBoardsScreen() {
  const router = useRouter();
  const { goToTab } = useTabNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");

  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [itemImages, setItemImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback((opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    return Promise.all([
      listSavedOutfits(),
      getSupabase().from("closet").select("id, image"),
    ])
      .then(([boards, { data: rows }]) => {
        setOutfits(boards);
        const map: Record<string, string> = {};
        for (const row of rows ?? []) {
          const uri = (row.image as string | null)?.trim();
          if (uri) map[row.id as string] = uri;
        }
        setItemImages(map);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  // Covers initial mount and returning from screens pushed over the pager.
  useFocusEffect(
    useCallback(() => {
      loadData({ silent: true });
    }, [loadData]),
  );

  // Covers switching to this tab: the tabs are pager scenes, not router
  // routes, so useFocusEffect alone never re-fires on a tab switch — this is
  // what picks up an outfit just saved from the closet tab.
  useTabFocusEffect("outfitBoards", () => loadData({ silent: true }));

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData({ silent: true });
  }, [loadData]);

  const cardW = (windowWidth - PAGE_PAD * 2 - GRID_GAP) / 2;
  const cardH = cardW * (190 / 150); // same aspect as the closet slider cards

  const confirmDelete = (outfit: SavedOutfit) => {
    Alert.alert("Delete this outfit?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSavedOutfit(outfit.id);
            setOutfits((prev) => prev.filter((o) => o.id !== outfit.id));
          } catch (e) {
            Alert.alert(
              "Could not delete outfit",
              e instanceof Error ? e.message : "Unknown error",
            );
          }
        },
      },
    ]);
  };

  const renderBoard = (outfit: SavedOutfit) => {
    const f = Math.min(
      cardW / Math.max(outfit.canvasW, 1),
      cardH / Math.max(outfit.canvasH, 1),
    );
    return (
      <View style={{ width: cardW }}>
      <Pressable
        onPress={() => {
          goToTab("closet");
          router.navigate({
            pathname: "/(tabs)/closet",
            params: { editOutfitId: outfit.id },
          });
        }}
        onLongPress={() => confirmDelete(outfit)}
        style={({ pressed }) => [
          styles.boardCard,
          { width: cardW, height: cardH, borderColor },
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Saved outfit. Tap to edit, long-press to delete."
      >
        {outfit.items.map((si) => {
          const uri = itemImages[si.id];
          if (!uri) return null; // item since removed from closet
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
                source={{ uri }}
                style={styles.boardItemImage}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            </View>
          );
        })}
      </Pressable>
      <ThemedText style={styles.boardDate}>
        {formatBoardDate(outfit.createdAt)}
      </ThemedText>
      </View>
    );
  };

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={outfits}
        keyExtractor={(o) => o.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        renderItem={({ item }) => renderBoard(item)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <ThemedText style={styles.empty}>
            No outfit boards yet. Make one from the closet tab’s + menu.
          </ThemedText>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  gridContent: {
    padding: PAGE_PAD,
    gap: GRID_GAP,
  },
  gridRow: {
    gap: GRID_GAP,
  },
  boardCard: {
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  boardItemImage: {
    width: "100%",
    height: "100%",
  },
  boardDate: {
    fontSize: 11,
    opacity: 0.55,
    textAlign: "center",
    marginTop: 4,
  },
  empty: {
    textAlign: "center",
    marginTop: 32,
    opacity: 0.7,
  },
});
