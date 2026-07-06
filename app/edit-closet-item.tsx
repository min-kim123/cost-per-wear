import { uploadClosetItemImage } from "@/lib/closet-upload";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { BrandInput } from "@/components/brand-input";
import { CategoryPicker, type Category } from "@/components/category-picker";
import { PasteImageButton } from "@/components/paste-image-button";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { DAILY_STACK_CATEGORY_NAME, listCategories } from "@/lib/categories";
import { writeClipboardImageToLocalUri } from "@/lib/clipboard-image";
import { onImageCaptured } from "@/lib/image-capture-bridge";
import { liftSubject, subjectLiftAvailable } from "@/lib/subject-lift";
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
  const [category, setCategory] = useState<Category | null>(null);
  const [originalCategory, setOriginalCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [imageCleared, setImageCleared] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  const [loadingItem, setLoadingItem] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const [lifting, setLifting] = useState(false);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#EFEFF4" }, "background");

  useEffect(() => {
    if (!id) return;
    const supabase = getSupabase();
    supabase
      .from("closet")
      .select("id, brand, name, cost, wears, image, created_at, category")
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
        setCategory((data.category as Category | null) ?? null);
        setOriginalCategory((data.category as Category | null) ?? null);
      })
      .finally(() => setLoadingItem(false));
  }, [id, router]);

  useEffect(() => {
    listCategories()
      .then((rows) => setCategories(rows.map((r) => r.name)))
      .catch(() => setCategories([]));
  }, []);

  // Picks up the image captured on the web-capture or crop-image screen when it navigates back to us
  useEffect(() => {
    return onImageCaptured((uri) => {
      setPickedUri(uri);
      setImageCleared(false);
    });
  }, []);

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
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Photo library",
            "Allow photo library access in Settings.",
          );
          return;
        }
        const result =
          await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) {
          setPickedUri(result.assets[0].uri);
          setImageCleared(false);
        }
      }
    } catch (e) {
      Alert.alert(
        "Photo",
        e instanceof Error ? e.message : "Could not open picker.",
      );
    } finally {
      setPicking(false);
    }
  };

  const clearImage = () => {
    setPickedUri(null);
    setImageCleared(true);
  };

  const pasteImage = async (data: string) => {
    const uri = await writeClipboardImageToLocalUri(data);
    setPickedUri(uri);
    setImageCleared(false);
  };

  const runCutout = async () => {
    const sourceUri = pickedUri ?? (imageCleared ? null : existingImageUrl);
    if (!sourceUri || busy) return;
    setLifting(true);
    try {
      let localUri = sourceUri;
      // Existing item images are remote Supabase URLs; the native module needs a local file
      if (/^https?:/.test(sourceUri)) {
        const dest = `${FileSystem.cacheDirectory}cutout-src-${Date.now()}.jpg`;
        const { uri } = await FileSystem.downloadAsync(sourceUri, dest);
        localUri = uri;
      }
      const cutoutUri = await liftSubject(localUri);
      setPickedUri(cutoutUri);
      setImageCleared(false);
    } catch (e) {
      Alert.alert(
        "Cutout failed",
        e instanceof Error ? e.message : "Could not remove the background.",
      );
    } finally {
      setLifting(false);
    }
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
    const wears =
      Number.isFinite(parsedWears) && parsedWears >= 0 ? parsedWears : 0;

    setSaving(true);
    try {
      const supabase = getSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let image: string | null;
      if (pickedUri) {
        image = await uploadClosetItemImage(pickedUri, user?.id);
      } else if (imageCleared) {
        image = null;
      } else {
        image = existingImageUrl;
      }

      const enteringDailyStack =
        category === DAILY_STACK_CATEGORY_NAME && originalCategory !== DAILY_STACK_CATEGORY_NAME;
      const leavingDailyStack =
        category !== DAILY_STACK_CATEGORY_NAME && originalCategory === DAILY_STACK_CATEGORY_NAME;

      const { error } = await supabase
        .from("closet")
        .update({
          name: trimmed,
          brand: brand.trim(),
          cost,
          wears,
          image,
          category: category ?? null,
          ...(enteringDailyStack ? { daily_stack_since: new Date().toISOString() } : {}),
          ...(leavingDailyStack ? { daily_stack_since: null } : {}),
        })
        .eq("id", id);

      if (error) throw new Error(error.message);
      router.back();
    } catch (e) {
      Alert.alert(
        "Could not save",
        e instanceof Error ? e.message : "Unknown error",
      );
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
      Alert.alert(
        "Could not delete",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setDeleting(false);
    }
  };

  const displayUri = pickedUri ?? (imageCleared ? null : existingImageUrl);
  const busy = saving || deleting || picking || lifting;

  const inputCompact = [
    styles.inputCompact,
    { color: textColor, borderColor, backgroundColor: inputBackground },
  ];

  if (loadingItem) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.flex}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scrollContent}
      enableOnAndroid
      extraScrollHeight={Platform.OS === "ios" ? 20 : 80}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => setShowMenu(true)}
              disabled={busy}
              style={({ pressed }) => [pressed && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color="#666" />
            </Pressable>
          ),
        }}
      />

      <Modal
        visible={showMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.menuSheet}>
            <View style={styles.menuHandle} />

            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => { setShowMenu(false); Alert.alert("Coming soon", "Archive is not yet available."); }}
            >
              <Ionicons name="archive-outline" size={22} color="#888" />
              <ThemedText style={[styles.menuItemText, { color: "#888" }]}>Archive</ThemedText>
              <ThemedText style={styles.menuItemBadge}>Soon</ThemedText>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => { setShowMenu(false); Alert.alert("Coming soon", "Sell on Depop is not yet available."); }}
            >
              <Ionicons name="pricetag-outline" size={22} color="#888" />
              <ThemedText style={[styles.menuItemText, { color: "#888" }]}>Sell on Depop</ThemedText>
              <ThemedText style={styles.menuItemBadge}>Soon</ThemedText>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => { setShowMenu(false); setConfirmingDelete(true); }}
            >
              <Ionicons name="trash-outline" size={22} color="#C00" />
              <ThemedText style={[styles.menuItemText, { color: "#C00" }]}>Delete</ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuCancel, pressed && { opacity: 0.7 }]}
              onPress={() => setShowMenu(false)}
            >
              <ThemedText style={styles.menuCancelText}>Cancel</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ThemedView style={styles.page}>
        {/* ── Image + fields row ─────────────────────────────────── */}
        <View style={styles.mainRow}>
          {/* Image column */}
          <View style={styles.imageCol}>
            <View>
              {displayUri ? (
                <Image
                  source={{ uri: displayUri }}
                  style={styles.preview}
                  contentFit="contain"
                />
              ) : (
                <View style={[styles.preview, styles.previewPlaceholder, { borderColor }]}>
                  <Ionicons name="image-outline" size={32} color={placeholderColor} />
                </View>
              )}
              {displayUri ? (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/crop-image",
                      params: { uri: displayUri, returnTo: "edit", id },
                    })
                  }
                  disabled={busy}
                  style={styles.editImageBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Edit photo"
                >
                  <Ionicons name="pencil" size={14} color="#fff" />
                </Pressable>
              ) : null}
              {displayUri && subjectLiftAvailable() ? (
                <Pressable
                  onPress={runCutout}
                  disabled={busy}
                  style={styles.cutoutBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Cut out subject"
                >
                  {lifting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="sparkles" size={14} color="#fff" />
                  )}
                </Pressable>
              ) : null}
            </View>
            <View style={styles.imageActions}>
              <Pressable
                onPress={() => runPicker("camera")}
                disabled={busy}
                style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
              >
                <Ionicons name="camera-outline" size={16} color={textColor} />
              </Pressable>
              <Pressable
                onPress={() => runPicker("library")}
                disabled={busy}
                style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
              >
                <Ionicons name="images-outline" size={16} color={textColor} />
              </Pressable>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/web-capture",
                    params: { returnTo: "edit", id },
                  })
                }
                disabled={busy}
                style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                accessibilityRole="button"
                accessibilityLabel="Capture image from the web"
              >
                <Ionicons name="globe-outline" size={16} color={textColor} />
              </Pressable>
              <PasteImageButton
                size={{ width: 32, height: 32 }}
                style={{ borderWidth: 1, borderColor }}
                backgroundColor={inputBackground}
                foregroundColor={textColor}
                cornerStyle="small"
                displayMode="iconOnly"
                disabled={busy}
                accessibilityLabel="Paste image from clipboard"
                onImage={pasteImage}
              >
                <Ionicons name="clipboard-outline" size={16} color={textColor} />
              </PasteImageButton>
              {displayUri ? (
                <Pressable
                  onPress={clearImage}
                  disabled={busy}
                  style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                >
                  <Ionicons name="close-outline" size={16} color="#C00" />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Fields column */}
          <View style={styles.fieldsCol}>
            <BrandInput value={brand} onChange={setBrand} editable={!busy} />
            <TextInput
              accessibilityLabel="Item name"
              placeholder="Name *"
              placeholderTextColor={placeholderColor}
              value={name}
              onChangeText={setName}
              style={inputCompact}
              editable={!busy}
              returnKeyType="next"
            />
            <TextInput
              accessibilityLabel="Item cost in dollars"
              placeholder="Cost ($)"
              placeholderTextColor={placeholderColor}
              value={costText}
              onChangeText={setCostText}
              keyboardType="decimal-pad"
              style={inputCompact}
              editable={!busy}
              returnKeyType="next"
            />
            <TextInput
              accessibilityLabel="Number of times worn"
              placeholder="Prev. wears"
              placeholderTextColor={placeholderColor}
              value={wearsText}
              onChangeText={(v) => setWearsText(v.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              style={inputCompact}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
          </View>
        </View>

        {/* ── Category ──────────────────────────────────────────── */}
        <ThemedText style={styles.categoryLabel}>Category</ThemedText>
        <CategoryPicker
          value={category}
          onChange={setCategory}
          categories={categories}
          nullable
          disabled={busy}
        />

        {/* ── Meta ──────────────────────────────────────────────── */}
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

        {/* ── Save button ───────────────────────────────────────── */}
        <Pressable
          onPress={onSave}
          disabled={busy}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.85 },
            busy && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.saveBtnText} lightColor="#fff" darkColor="#fff">
              Save
            </ThemedText>
          )}
        </Pressable>

        {/* ── Delete confirm ────────────────────────────────────── */}
        {confirmingDelete ? (
          <View style={[styles.confirmRow, { borderColor: "#C00" }]}>
            <ThemedText style={styles.confirmText}>Permanently delete this item?</ThemedText>
            <View style={styles.confirmButtons}>
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={[styles.confirmCancel, { borderColor }]}
              >
                <ThemedText style={styles.confirmCancelText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={deleting}
                style={({ pressed }) => [styles.confirmDeleteBtn, pressed && { opacity: 0.7 }]}
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
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { flexGrow: 1 },

  // ── Page ──────────────────────────────────────────────────────────
  page: { flex: 1, padding: 16, paddingBottom: 28, gap: 10 },

  // ── Main row: image left, fields right ────────────────────────────
  mainRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },

  imageCol: { gap: 6 },
  preview: {
    width: 110,
    aspectRatio: 3 / 4,
    borderRadius: 10,
    backgroundColor: "rgba(128,128,128,0.15)",
    flexShrink: 0,
  },
  previewPlaceholder: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  editImageBtn: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  cutoutBtn: {
    position: "absolute",
    left: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageActions: { flexDirection: "row", gap: 6, justifyContent: "center" },
  imageBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  fieldsCol: { flex: 1, gap: 8 },
  inputCompact: {
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    fontSize: 14,
  },

  // ── Category ──────────────────────────────────────────────────────
  categoryLabel: {
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.65,
    marginTop: 2,
  },

  // ── Meta ──────────────────────────────────────────────────────────
  addedOn: { fontSize: 12, opacity: 0.45, marginTop: 2 },

  // ── Save button ───────────────────────────────────────────────────
  saveBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  saveBtnText: { fontSize: 16, fontWeight: "700" },

  // ── Delete confirm ────────────────────────────────────────────────
  confirmRow: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  confirmText: { fontSize: 14, textAlign: "center", color: "#C00" },
  confirmButtons: { flexDirection: "row", gap: 10 },
  confirmCancel: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelText: { fontSize: 15, fontWeight: "600" },
  confirmDeleteBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#C00",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDeleteText: { fontSize: 15, fontWeight: "600", color: "#fff" },

  // ── Menu sheet ────────────────────────────────────────────────────
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingBottom: 36,
    paddingTop: 12,
  },
  menuHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  menuItemPressed: { opacity: 0.6 },
  menuItemText: { flex: 1, fontSize: 16 },
  menuItemBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: "#aaa",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#e5e5e5",
    marginHorizontal: 4,
  },
  menuCancel: {
    marginTop: 10,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#f2f2f7",
    alignItems: "center",
    justifyContent: "center",
  },
  menuCancelText: { fontSize: 16, fontWeight: "600" },
});
