import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { DAILY_STACK_CATEGORY_NAME } from "@/lib/categories";
import { requestHomeCameraReset } from "@/lib/home-camera-reset";
import { draftPhotoExists, saveOutfitForToday } from "@/lib/outfit-storage";
import { getSupabase } from "@/lib/supabase-client";

type ClothingItem = {
  id: string;
  brand: string;
  name: string;
  image: ImageSourcePropType;
  wears: number;
  cost: number;
  category: string | null;
};

async function loadClosetItems(): Promise<ClothingItem[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("closet")
    .select("id, brand, name, cost, wears, image, category")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const uri = (row.image as string | null)?.trim();
    return {
      id: row.id as string,
      brand: (row.brand as string | null) ?? "",
      name: row.name as string,
      cost: typeof row.cost === "number" ? row.cost : parseFloat(row.cost as string) || 0,
      wears: typeof row.wears === "number" ? row.wears : 0,
      image: uri ? { uri } : (require("@/assets/images/image.png") as ImageSourcePropType),
      category: (row.category as string | null) ?? null,
    };
  });
}

export default function SelectOutfitItemsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const prevItemIdsRef = useRef<Set<string> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([loadClosetItems(), draftPhotoExists()])
        .then(([list, draft]) => {
          if (!active) return;
          const currentIds = new Set(list.map((i) => i.id));
          // Only auto-select on return from another screen, not on first load
          if (prevItemIdsRef.current !== null) {
            const newIds = list
              .map((i) => i.id)
              .filter((id) => !prevItemIdsRef.current!.has(id));
            if (newIds.length > 0) {
              setSelected((prev) => {
                const next = new Set(prev);
                newIds.forEach((id) => next.add(id));
                return next;
              });
            }
          }
          prevItemIdsRef.current = currentIds;
          setItems(list);
          setHasDraft(draft);
          if (!draft) {
            Alert.alert("No photo", "Take an outfit photo on Home first.", [
              { text: "OK", onPress: () => router.back() },
            ]);
          }
        })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [router]),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const onSave = async () => {
    if (!hasDraft) return;
    setSaving(true);
    try {
      const selectedIds = Array.from(selected).filter((id) => !dailyStackIdSet.has(id));
      await saveOutfitForToday([...selectedIds, ...dailyStackItemIds]);
      requestHomeCameraReset();
      router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
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
      <Stack.Screen
        options={{
          title: "What did you wear?",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/add-closet-item")}
              hitSlop={8}
              accessibilityLabel="Add new item"
            >
              <Ionicons name="add" size={26} color="#000" />
            </Pressable>
          ),
        }}
      />
      <ThemedText style={styles.hint}>Tap items to include in today&apos;s outfit.</ThemedText>
      <FlatList
        data={pickableItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              style={[styles.row, on && styles.rowSelected]}
            >
              <Image source={item.image} style={styles.thumb} contentFit="contain" />
              <View style={styles.rowText}>
                {item.brand.trim() ? (
                  <ThemedText numberOfLines={1} style={styles.rowBrand}>
                    {item.brand}
                  </ThemedText>
                ) : null}
                <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                <ThemedText>{`${item.wears} wears`}</ThemedText>
              </View>
              <Ionicons
                name={on ? "checkmark-circle" : "ellipse-outline"}
                size={28}
                color={on ? "#22c55e" : "#888"}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Pressable
            onPress={() => router.push("/add-closet-item")}
            style={styles.emptyAdd}
          >
            <Ionicons name="add-circle-outline" size={32} color="rgba(128,128,128,0.6)" />
            <Text style={styles.emptyAddText}>Add your first closet item</Text>
          </Pressable>
        }
      />
      <View style={styles.footer}>
        <Pressable
          style={[styles.saveBtn, (!hasDraft || saving) && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={!hasDraft || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save outfit</Text>
          )}
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 8,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  hint: {
    paddingHorizontal: 16,
    marginBottom: 12,
    opacity: 0.8,
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.3)",
  },
  rowSelected: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowBrand: {
    fontSize: 13,
    opacity: 0.65,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.3)",
  },
  saveBtn: {
    backgroundColor: "#111",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  emptyAdd: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyAddText: {
    fontSize: 15,
    color: "rgba(128,128,128,0.8)",
  },
});
