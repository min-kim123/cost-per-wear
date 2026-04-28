import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { uploadClosetItemImage } from "@/lib/closet-upload";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandInput } from "@/components/brand-input";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { getSupabase } from "@/supabase-client";

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [3, 4],
  quality: 0.85,
};


export default function EditClosetItemScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [costText, setCostText] = useState("");
  const [wearsText, setWearsText] = useState("");
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [imageCleared, setImageCleared] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  const [loadingItem, setLoadingItem] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [picking, setPicking] = useState(false);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#EFEFF4" }, "background");

  const inputStyle = [
    styles.input,
    { color: textColor, borderColor, backgroundColor: inputBackground },
  ];

  useEffect(() => {
    if (!id) return;
    const supabase = getSupabase();
    supabase
      .from("closet")
      .select("id, brand, name, cost, wears, image, created_at")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          Alert.alert("Error", "Could not load item.");
          router.back();
          return;
        }
        setBrand(data.brand ?? "");
        setName(data.name ?? "");
        setCostText(data.cost != null ? String(data.cost) : "");
        setWearsText(data.wears != null ? String(data.wears) : "0");
        setExistingImageUrl(data.image ?? null);
        setCreatedAt(data.created_at ?? null);
      })
      .finally(() => setLoadingItem(false));
  }, [id, router]);

  const runPicker = async (mode: "camera" | "library") => {
    if (picking || saving) return;
    setPicking(true);
    try {
      if (mode === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Camera access", "Allow camera access in Settings.");
          return;
        }
        const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) {
          setPickedUri(result.assets[0].uri);
          setImageCleared(false);
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Photo library", "Allow photo library access in Settings.");
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) {
          setPickedUri(result.assets[0].uri);
          setImageCleared(false);
        }
      }
    } catch (e) {
      Alert.alert("Photo", e instanceof Error ? e.message : "Could not open picker.");
    } finally {
      setPicking(false);
    }
  };

  const clearImage = () => {
    setPickedUri(null);
    setImageCleared(true);
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Name required", "Enter a name for this item.");
      return;
    }
    const parsed = parseFloat(costText.replace(/,/g, ""));
    const cost = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const parsedWears = parseInt(wearsText, 10);
    const wears = Number.isFinite(parsedWears) && parsedWears >= 0 ? parsedWears : 0;

    setSaving(true);
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();

      let image: string | null;
      if (pickedUri) {
        image = await uploadClosetItemImage(pickedUri, user?.id);
      } else if (imageCleared) {
        image = null;
      } else {
        image = existingImageUrl;
      }

      const { error } = await supabase
        .from("closet")
        .update({ name: trimmed, brand: brand.trim(), cost, wears, image })
        .eq("id", id);

      if (error) throw new Error(error.message);
      router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await getSupabase()
        .from("closet")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
      router.back();
    } catch (e) {
      setConfirmingDelete(false);
      Alert.alert("Could not delete", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setDeleting(false);
    }
  };

  const insets = useSafeAreaInsets();
  const displayUri = pickedUri ?? (imageCleared ? null : existingImageUrl);
  const busy = saving || deleting || picking;

  if (loadingItem) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => setConfirmingDelete(true)}
              disabled={busy || confirmingDelete}
              style={({ pressed }) => [pressed && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel="Delete item"
            >
              <Ionicons name="trash-outline" size={22} color="#C00" />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <ThemedView style={styles.container}>
          <ThemedText type="defaultSemiBold" style={styles.label}>
            Photo
          </ThemedText>
          <View style={[styles.previewWrap, { borderColor }]}>
            {displayUri ? (
              <Image
                source={{ uri: displayUri }}
                style={styles.previewImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons name="image-outline" size={40} color={placeholderColor} />
                <ThemedText style={[styles.previewHint, { opacity: 0.65 }]}>
                  Use Camera or Library below (optional)
                </ThemedText>
              </View>
            )}
          </View>

          <View style={styles.photoActions}>
            <Pressable
              onPress={() => runPicker("camera")}
              disabled={busy}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed,
                busy && styles.photoBtnDisabled,
              ]}
            >
              <Ionicons name="camera-outline" size={22} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Camera</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => runPicker("library")}
              disabled={busy}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed,
                busy && styles.photoBtnDisabled,
              ]}
            >
              <Ionicons name="images-outline" size={22} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Library</ThemedText>
            </Pressable>
          </View>

          {displayUri ? (
            <Pressable
              onPress={clearImage}
              disabled={busy}
              style={styles.clearPhoto}
            >
              <ThemedText type="link" style={styles.clearPhotoText}>
                Remove photo
              </ThemedText>
            </Pressable>
          ) : null}

          {createdAt ? (
            <ThemedText style={styles.addedOn}>
              Added{" "}
              {new Date(createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </ThemedText>
          ) : null}

          <ThemedText type="defaultSemiBold" style={styles.label}>Brand</ThemedText>
          <BrandInput
            value={brand}
            onChange={setBrand}
            editable={!busy}
          />

          <ThemedText type="defaultSemiBold" style={styles.label}>Name</ThemedText>
          <TextInput
            accessibilityLabel="Item name"
            placeholder="e.g. Navy chinos"
            placeholderTextColor={placeholderColor}
            value={name}
            onChangeText={setName}
            style={inputStyle}
            editable={!busy}
          />

          <ThemedText type="defaultSemiBold" style={styles.label}>Cost ($)</ThemedText>
          <TextInput
            accessibilityLabel="Item cost in dollars"
            placeholder="0"
            placeholderTextColor={placeholderColor}
            value={costText}
            onChangeText={setCostText}
            keyboardType="decimal-pad"
            style={inputStyle}
            editable={!busy}
          />

          <ThemedText type="defaultSemiBold" style={styles.label}>Wears</ThemedText>
          <TextInput
            accessibilityLabel="Number of times worn"
            placeholder="0"
            placeholderTextColor={placeholderColor}
            value={wearsText}
            onChangeText={(v) => setWearsText(v.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            style={inputStyle}
            editable={!busy}
          />
        </ThemedView>
      </ScrollView>

      <ThemedView style={[styles.footer, { paddingBottom: insets.bottom + 12, borderColor }]}>
        <Pressable
          onPress={onSave}
          disabled={busy}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && styles.saveBtnPressed,
            busy && styles.saveBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.saveBtnText} lightColor="#fff" darkColor="#fff">
              Save changes
            </ThemedText>
          )}
        </Pressable>

        {confirmingDelete ? (
          <View style={styles.confirmRow}>
            <ThemedText style={styles.confirmText}>
              Permanently delete this item?
            </ThemedText>
            <View style={styles.confirmButtons}>
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={({ pressed }) => [styles.confirmCancel, { borderColor }, pressed && styles.photoBtnPressed]}
              >
                <ThemedText style={styles.confirmCancelText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={deleting}
                style={({ pressed }) => [styles.confirmDeleteBtn, pressed && styles.deleteBtnPressed]}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.confirmDeleteText}>Delete</ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { flexGrow: 1 },
  container: { flex: 1, padding: 20, paddingBottom: 16, gap: 8 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: { marginTop: 12 },
  addedOn: { fontSize: 13, opacity: 0.5, marginTop: 4 },
  previewWrap: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: 3 / 4,
    maxHeight: 220,
    alignSelf: "center",
    width: "100%",
  },
  previewImage: { width: "100%", height: "100%" },
  previewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  previewHint: { fontSize: 14, textAlign: "center" },
  photoActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
  },
  photoBtnLabel: { fontSize: 15, fontWeight: "600" },
  photoBtnPressed: { opacity: 0.85 },
  photoBtnDisabled: { opacity: 0.5 },
  clearPhoto: { alignSelf: "center", marginTop: 6, paddingVertical: 4 },
  clearPhotoText: { fontSize: 15 },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  saveBtn: {
    height: 48,
    borderRadius: 10,
    backgroundColor: "#0a7ea4",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: "600" },
  deleteBtnPressed: { opacity: 0.7 },
  confirmRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C00",
    padding: 14,
    gap: 12,
  },
  confirmText: {
    fontSize: 14,
    textAlign: "center",
    color: "#C00",
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 10,
  },
  confirmCancel: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  confirmDeleteBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#C00",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDeleteText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
