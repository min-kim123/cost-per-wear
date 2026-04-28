import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import { requestHomeCameraReset } from "@/lib/home-camera-reset";
import { draftPhotoExists, saveOutfitForToday } from "@/lib/outfit-storage";
import { getSupabase } from "@/supabase-client";

type ClothingItem = {
  id: string;
  brand: string;
  name: string;
  image: ImageSourcePropType;
  wears: number;
  cost: number;
};

async function loadClosetItems(): Promise<ClothingItem[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("closet")
    .select("id, brand, name, cost, wears, image")
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, draft] = await Promise.all([loadClosetItems(), draftPhotoExists()]);
      setItems(list);
      setHasDraft(draft);
      if (!draft) {
        Alert.alert("No photo", "Take an outfit photo on Home first.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSave = async () => {
    if (!hasDraft) return;
    setSaving(true);
    try {
      await saveOutfitForToday(Array.from(selected));
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
      <ThemedText type="subtitle" style={styles.title}>
        What did you wear?
      </ThemedText>
      <ThemedText style={styles.hint}>Tap items to include in today&apos;s outfit.</ThemedText>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              style={[styles.row, on && styles.rowSelected]}
            >
              <Image source={item.image} style={styles.thumb} contentFit="cover" />
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
  title: {
    paddingHorizontal: 16,
    marginBottom: 4,
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
});
