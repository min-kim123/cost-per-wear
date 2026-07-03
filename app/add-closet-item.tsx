import { uploadClosetItemImage } from "@/lib/closet-upload";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { BrandInput } from "@/components/brand-input";
import { CategoryPicker, type Category } from "@/components/category-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { listCategories } from "@/lib/categories";
import { liftSubject, subjectLiftAvailable } from "@/lib/subject-lift";
import { getSupabase } from "@/supabase-client";

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [3, 4],
  quality: 0.85,
};

type BulkItem = {
  uri: string;
  brand: string;
  name: string;
  costText: string;
  wearsText: string;
  category: Category | null;
  processingBg?: boolean;
};

// ── Phase types ──────────────────────────────────────────────────────────────
// "pick"      → initial screen: camera / library buttons
// "capturing" → camera multi-shot phase
// "editing"   → fill in details for each photo

export default function AddClosetItemScreen() {
  const router = useRouter();
  const { capturedUri, capturedUris } = useLocalSearchParams<{
    capturedUri?: string;
    capturedUris?: string;
  }>();

  const [phase, setPhase] = useState<"pick" | "capturing" | "editing">("pick");
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkIndex, setBulkIndex] = useState(0);
  const [pendingUris, setPendingUris] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  const costRef = useRef<TextInput>(null);
  const wearsRef = useRef<TextInput>(null);

  useEffect(() => {
    listCategories()
      .then((rows) => setCategories(rows.map((r) => r.name)))
      .catch(() => setCategories([]));
  }, []);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#EFEFF4" }, "background");

  const inputCompact = [
    styles.inputCompact,
    { color: textColor, borderColor, backgroundColor: inputBackground },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────
  function startEditingWithUris(uris: string[]) {
    const canLiftSubject = subjectLiftAvailable();
    setBulkItems(
      uris.map((uri) => ({
        uri,
        brand: "",
        name: "",
        costText: "",
        wearsText: "",
        category: null,
        processingBg: canLiftSubject,
      })),
    );
    setBulkIndex(0);
    setPhase("editing");

    if (canLiftSubject) {
      uris.forEach((originalUri, index) => {
        liftSubject(originalUri)
          .then((cutoutUri) => {
            setBulkItems((prev) => {
              if (prev[index]?.uri !== originalUri) return prev;
              const next = [...prev];
              next[index] = { ...next[index], uri: cutoutUri, processingBg: false };
              return next;
            });
          })
          .catch(() => {
            setBulkItems((prev) => {
              if (prev[index]?.uri !== originalUri) return prev;
              const next = [...prev];
              next[index] = { ...next[index], processingBg: false };
              return next;
            });
          });
      });
    }
  }

  // Arrived here with photo(s) already picked — either a single image from the
  // web-capture screen or the camera, or multiple from a library multi-select,
  // both picked from the closet FAB before navigating here.
  useEffect(() => {
    if (typeof capturedUri === "string" && capturedUri) {
      startEditingWithUris([capturedUri]);
      return;
    }
    if (typeof capturedUris === "string" && capturedUris) {
      try {
        const uris = JSON.parse(capturedUris);
        if (Array.isArray(uris) && uris.length > 0) startEditingWithUris(uris);
      } catch {
        // ignore malformed param
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedUri, capturedUris]);

  // ── Photo pickers ─────────────────────────────────────────────────────────
  const pickFromLibrary = async () => {
    if (picking) return;
    setPicking(true);
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
        startEditingWithUris(result.assets.map((a) => a.uri));
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open library.");
    } finally {
      setPicking(false);
    }
  };

  const startCamera = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera access", "Allow camera access in Settings.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (!result.canceled && result.assets[0]?.uri) {
        setPendingUris([result.assets[0].uri]);
        setPhase("capturing");
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open camera.");
    } finally {
      setPicking(false);
    }
  };

  const takeBulkPhoto = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (!result.canceled && result.assets[0]?.uri) {
        setPendingUris((prev) => [...prev, result.assets[0].uri]);
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open camera.");
    } finally {
      setPicking(false);
    }
  };

  // ── Bulk field update ─────────────────────────────────────────────────────
  const updateField = (field: keyof Omit<BulkItem, "uri">, value: string | Category | null) => {
    setBulkItems((prev) => {
      const next = [...prev];
      next[bulkIndex] = { ...next[bulkIndex], [field]: value };
      return next;
    });
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const onNext = async () => {
    const current = bulkItems[bulkIndex];
    if (!current.name.trim()) {
      Alert.alert("Name required", "Enter a name for this item.");
      return;
    }
    if (bulkIndex < bulkItems.length - 1) {
      setBulkIndex((i) => i + 1);
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      for (const item of bulkItems) {
        if (!item.name.trim()) continue;
        const parsed = parseFloat(item.costText.replace(/,/g, ""));
        const cost = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        const parsedWears = parseInt(item.wearsText, 10);
        const wears = Number.isFinite(parsedWears) && parsedWears >= 0 ? parsedWears : 0;
        const image = item.uri ? await uploadClosetItemImage(item.uri, user?.id) : null;
        await supabase.from("closet").insert({
          name: item.name.trim(),
          brand: item.brand.trim(),
          cost: Number(cost),
          wears,
          image,
          category: item.category ?? null,
          user_id: user?.id,
        });
      }
      router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  // ── Phase: capturing (camera multi-shot) ──────────────────────────────────
  if (phase === "capturing") {
    return (
      <ThemedView style={styles.capturePage}>
        <ThemedText type="subtitle" style={styles.captureCount}>
          {pendingUris.length} photo{pendingUris.length !== 1 ? "s" : ""} taken
        </ThemedText>
        <View style={styles.captureThumbs}>
          {pendingUris.slice(-4).map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.captureThumb} contentFit="cover" />
          ))}
        </View>
        <Pressable
          onPress={takeBulkPhoto}
          disabled={picking}
          style={({ pressed }) => [
            styles.captureBtn,
            { borderColor, backgroundColor: inputBackground },
            pressed && { opacity: 0.8 },
            picking && { opacity: 0.5 },
          ]}
        >
          <Ionicons name="camera-outline" size={22} color={textColor} />
          <ThemedText style={styles.captureBtnLabel}>Take another</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => { startEditingWithUris(pendingUris); setPendingUris([]); }}
          disabled={pendingUris.length === 0}
          style={({ pressed }) => [
            styles.captureStart,
            pressed && { opacity: 0.85 },
            pendingUris.length === 0 && { opacity: 0.45 },
          ]}
        >
          <ThemedText style={styles.captureStartLabel} lightColor="#fff" darkColor="#fff">
            Done — fill in details →
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => { setPhase("pick"); setPendingUris([]); }} style={styles.cancelLink}>
          <ThemedText type="link">Cancel</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  // ── Phase: editing wizard ─────────────────────────────────────────────────
  if (phase === "editing") {
    const current = bulkItems[bulkIndex];
    const progress = (bulkIndex + 1) / bulkItems.length;
    const isLast = bulkIndex === bulkItems.length - 1;

    return (
      <KeyboardAwareScrollView
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        enableOnAndroid
        extraScrollHeight={Platform.OS === "ios" ? 20 : 80}
      >
        <ThemedView style={styles.wizardPage}>
          <View style={styles.wizardHeader}>
            <ThemedText style={styles.wizardProgress}>
              {bulkItems.length > 1
                ? `Item ${bulkIndex + 1} of ${bulkItems.length}`
                : "Item details"}
            </ThemedText>
            <Pressable onPress={() => setPhase("pick")}>
              <ThemedText type="link" style={styles.cancelInline}>Cancel</ThemedText>
            </Pressable>
          </View>

          {bulkItems.length > 1 && (
            <View style={[styles.progressTrack, { borderColor }]}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
          )}

          <View style={styles.wizardRow}>
            <View style={styles.wizardPreviewWrap}>
              <Image
                source={{ uri: current.uri }}
                style={styles.wizardPreview}
                contentFit="contain"
              />
              {current.processingBg && (
                <View style={styles.wizardPreviewOverlay}>
                  <ActivityIndicator color="#fff" />
                  <ThemedText style={styles.wizardPreviewOverlayText} lightColor="#fff" darkColor="#fff">
                    Removing background…
                  </ThemedText>
                </View>
              )}
            </View>
            <View style={styles.wizardFields}>
              <BrandInput
                value={current.brand}
                onChange={(v) => updateField("brand", v)}
                editable={!saving}
              />
              <TextInput
                accessibilityLabel="Item name"
                placeholder="Name *"
                placeholderTextColor={placeholderColor}
                value={current.name}
                onChangeText={(v) => updateField("name", v)}
                style={inputCompact}
                editable={!saving}
                returnKeyType="next"
                onSubmitEditing={() => costRef.current?.focus()}
              />
              <TextInput
                ref={costRef}
                accessibilityLabel="Cost"
                placeholder="Cost ($)"
                placeholderTextColor={placeholderColor}
                value={current.costText}
                onChangeText={(v) => updateField("costText", v)}
                keyboardType="numbers-and-punctuation"
                style={inputCompact}
                editable={!saving}
                returnKeyType="next"
                onSubmitEditing={() => wearsRef.current?.focus()}
              />
              <TextInput
                ref={wearsRef}
                accessibilityLabel="Previous wears"
                placeholder="Prev. wears"
                placeholderTextColor={placeholderColor}
                value={current.wearsText}
                onChangeText={(v) => updateField("wearsText", v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                style={inputCompact}
                editable={!saving}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>
          <ThemedText style={styles.categoryLabel}>Category</ThemedText>
          <CategoryPicker
            value={current.category}
            onChange={(cat) => updateField("category", cat)}
            categories={categories}
            nullable
            disabled={saving}
          />

          <Pressable
            onPress={onNext}
            disabled={saving || current.processingBg}
            style={({ pressed }) => [
              styles.nextBtn,
              pressed && { opacity: 0.85 },
              (saving || current.processingBg) && { opacity: 0.6 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.nextBtnLabel} lightColor="#fff" darkColor="#fff">
                {isLast
                  ? bulkItems.length > 1
                    ? `Save all ${bulkItems.length} items`
                    : "Save item"
                  : "Next →"}
              </ThemedText>
            )}
          </Pressable>
        </ThemedView>
      </KeyboardAwareScrollView>
    );
  }

  // ── Phase: pick photos (initial screen) ───────────────────────────────────
  return (
    <ThemedView style={styles.pickPage}>
      <ThemedText type="subtitle" style={styles.pickTitle}>
        Add photos to get started
      </ThemedText>
      <ThemedText style={styles.pickSubtitle}>
        Select one or more items to add to your closet
      </ThemedText>

      <View style={styles.pickBtns}>
        <Pressable
          onPress={startCamera}
          disabled={picking}
          style={({ pressed }) => [
            styles.pickBtn,
            { borderColor, backgroundColor: inputBackground },
            pressed && { opacity: 0.8 },
            picking && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Take photo with camera"
        >
          <Ionicons name="camera-outline" size={32} color={textColor} />
          <ThemedText style={styles.pickBtnLabel}>Camera</ThemedText>
          <ThemedText style={styles.pickBtnSub}>Take photos</ThemedText>
        </Pressable>

        <Pressable
          onPress={pickFromLibrary}
          disabled={picking}
          style={({ pressed }) => [
            styles.pickBtn,
            { borderColor, backgroundColor: inputBackground },
            pressed && { opacity: 0.8 },
            picking && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Choose from photo library"
        >
          <Ionicons name="images-outline" size={32} color={textColor} />
          <ThemedText style={styles.pickBtnLabel}>Library</ThemedText>
          <ThemedText style={styles.pickBtnSub}>Select multiple</ThemedText>
        </Pressable>
      </View>

      {picking && <ActivityIndicator style={styles.pickSpinner} />}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  // ── Pick page ──────────────────────────────────────────────────────
  pickPage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  pickTitle: { textAlign: "center" },
  pickSubtitle: { textAlign: "center", opacity: 0.55, fontSize: 14, marginBottom: 8 },
  pickBtns: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  pickBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 24,
    borderRadius: 14,
    borderWidth: 1,
  },
  pickBtnLabel: { fontSize: 15, fontWeight: "700" },
  pickBtnSub: { fontSize: 11, opacity: 0.5 },
  pickSpinner: { marginTop: 16 },

  // ── Capturing page ─────────────────────────────────────────────────
  capturePage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    padding: 32,
  },
  captureCount: { textAlign: "center" },
  captureThumbs: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  captureThumb: {
    width: 70,
    height: 93,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
  },
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 24,
    alignSelf: "stretch",
  },
  captureBtnLabel: { fontSize: 16, fontWeight: "600" },
  captureStart: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    paddingHorizontal: 24,
  },
  captureStartLabel: { fontSize: 16, fontWeight: "700" },
  cancelLink: { paddingVertical: 8 },

  // ── Wizard page ────────────────────────────────────────────────────
  wizardPage: { flex: 1, padding: 16, paddingBottom: 24, gap: 10 },
  wizardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wizardProgress: { fontSize: 14, fontWeight: "600" },
  cancelInline: { fontSize: 14 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#000",
    borderRadius: 2,
  },
  wizardRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  wizardPreviewWrap: {
    width: 110,
    flexShrink: 0,
  },
  wizardPreview: {
    width: 110,
    aspectRatio: 3 / 4,
    borderRadius: 10,
    backgroundColor: "rgba(128,128,128,0.15)",
    flexShrink: 0,
  },
  wizardPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 6,
  },
  wizardPreviewOverlayText: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
  },
  wizardFields: { flex: 1, gap: 8 },
  inputCompact: {
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.65,
    marginTop: 2,
  },
  nextBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  nextBtnLabel: { fontSize: 16, fontWeight: "700" },
});
