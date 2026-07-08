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
  ScrollView,
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
import { requestPhoneBgRemoval } from "@/lib/bg-removal-request";
import { addCategory, listCategories } from "@/lib/categories";
import { enqueueClosetSaves } from "@/lib/closet-save-queue";
import { onImageCaptured, onImagesCaptured } from "@/lib/image-capture-bridge";
import { saveToCameraRoll } from "@/lib/save-to-camera-roll";
import { liftSubject, subjectLiftAvailable } from "@/lib/subject-lift";

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
  // Background already removed (on-device lift, or the phone answered a
  // paste-time request) — don't also flag the item at save.
  bgRemoved?: boolean;
  // Original uploaded at paste time for the phone request — reused at save so
  // the image isn't uploaded twice.
  uploadedUrl?: string;
};

// ── Phase types ──────────────────────────────────────────────────────────────
// "pick"       → initial screen: camera / library buttons
// "capturing"  → camera multi-shot phase
// "processing" → full-screen wait while backgrounds are removed
// "review"     → check the cutouts; remove any that came out wrong
// "editing"    → fill in details for each photo

export default function AddClosetItemScreen() {
  const router = useRouter();
  const { capturedUri, capturedUris } = useLocalSearchParams<{
    capturedUri?: string;
    capturedUris?: string;
  }>();

  const [phase, setPhase] = useState<
    "pick" | "capturing" | "processing" | "review" | "editing"
  >("pick");
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkIndex, setBulkIndex] = useState(0);
  const [pendingUris, setPendingUris] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
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
    // On web, ask the user's iPhone to cut out each photo the moment it
    // arrives (paste, capture, upload) — the phone answers within seconds
    // via silent push/realtime and the cutout swaps in while the user fills
    // in details. No answer in time → the item is flagged at save instead.
    const phoneRemoval = !canLiftSubject && Platform.OS === "web";
    setBulkItems(
      uris.map((uri) => ({
        uri,
        brand: "",
        name: "",
        costText: "",
        wearsText: "",
        category: null,
        processingBg: canLiftSubject || phoneRemoval,
      })),
    );
    setBulkIndex(0);

    const patchItem = (index: number, originalUri: string, fields: Partial<BulkItem>) =>
      setBulkItems((prev) => {
        if (prev[index]?.uri !== originalUri) return prev;
        const next = [...prev];
        next[index] = { ...next[index], ...fields };
        return next;
      });

    if (canLiftSubject) {
      // Remove backgrounds up front behind a progress screen, then let the
      // user review the cutouts before filling in details.
      setPhase("processing");
      uris.forEach((originalUri, index) => {
        liftSubject(originalUri)
          .then((cutoutUri) =>
            patchItem(index, originalUri, { uri: cutoutUri, processingBg: false }),
          )
          .catch(() => patchItem(index, originalUri, { processingBg: false }));
      });
      return;
    }

    // The phone round-trip shouldn't block the form — go straight to editing
    // and show a per-item spinner until the cutout lands.
    setPhase("editing");
    if (!phoneRemoval) return;

    uris.forEach((originalUri, index) => {
      requestPhoneBgRemoval(originalUri)
        .then(({ sourceUrl, result }) => {
          patchItem(index, originalUri, { uploadedUrl: sourceUrl });
          return result;
        })
        .then((cutoutUrl) => {
          if (cutoutUrl) {
            patchItem(index, originalUri, {
              uri: cutoutUrl,
              bgRemoved: true,
              processingBg: false,
            });
          } else {
            patchItem(index, originalUri, { processingBg: false });
          }
        })
        .catch(() => patchItem(index, originalUri, { processingBg: false }));
    });
  }

  useEffect(() => {
    if (
      phase === "processing" &&
      bulkItems.length > 0 &&
      bulkItems.every((item) => !item.processingBg)
    ) {
      setPhase("review");
    }
  }, [phase, bulkItems]);

  function removeReviewItem(index: number) {
    const next = bulkItems.filter((_, i) => i !== index);
    setBulkItems(next);
    if (next.length === 0) setPhase("pick");
  }

  // Index currently being cropped from the review screen — set right before
  // navigating to /crop-image, consumed when it emits the result back to us.
  const reviewCropIndexRef = useRef<number | null>(null);

  function cropReviewItem(index: number, uri: string) {
    reviewCropIndexRef.current = index;
    router.push({
      pathname: "/crop-image",
      params: { uri, returnTo: "review" },
    });
  }

  useEffect(() => {
    return onImageCaptured((uri) => {
      const index = reviewCropIndexRef.current;
      reviewCropIndexRef.current = null;
      if (index == null) return;
      setBulkItems((prev) => {
        if (index >= prev.length) return prev;
        const next = [...prev];
        next[index] = { ...next[index], uri };
        return next;
      });
    });
  }, []);

  async function retakeReviewPhoto(index: number) {
    if (picking) return;
    setPicking(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera access", "Allow camera access in Settings.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      const newUri = result.assets[0].uri;
      saveToCameraRoll(newUri);

      const canLiftSubject = subjectLiftAvailable();
      setBulkItems((prev) => {
        if (index >= prev.length) return prev;
        const next = [...prev];
        next[index] = {
          ...next[index],
          uri: newUri,
          processingBg: canLiftSubject,
          bgRemoved: false,
          uploadedUrl: undefined,
        };
        return next;
      });
      if (!canLiftSubject) return;

      try {
        const cutoutUri = await liftSubject(newUri);
        setBulkItems((prev) => {
          if (index >= prev.length || prev[index].uri !== newUri) return prev;
          const next = [...prev];
          next[index] = { ...next[index], uri: cutoutUri, processingBg: false };
          return next;
        });
      } catch {
        setBulkItems((prev) => {
          if (index >= prev.length || prev[index].uri !== newUri) return prev;
          const next = [...prev];
          next[index] = { ...next[index], processingBg: false };
          return next;
        });
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open camera.");
    } finally {
      setPicking(false);
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
  }, [capturedUri, capturedUris]);

  // Picks up the cropped photos when the crop-image screen navigates back to us
  useEffect(() => {
    return onImagesCaptured((uris) => startEditingWithUris(uris));
  }, []);

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
        // Crop each photo (free-form) first; results come back via onImagesCaptured.
        router.push({
          pathname: "/crop-image",
          params: {
            uris: JSON.stringify(result.assets.map((a) => a.uri)),
            returnTo: "add",
          },
        });
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
        saveToCameraRoll(result.assets[0].uri);
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
        saveToCameraRoll(result.assets[0].uri);
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

  const handleAddCategory = async (name: string) => {
    const created = await addCategory(name);
    setCategories((prev) => [...prev, created.name]);
    return created.name;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  // Uploads run in the background (lib/closet-save-queue) so the modal can
  // dismiss immediately instead of blocking on slow image uploads.
  const onNext = () => {
    if (bulkIndex < bulkItems.length - 1) {
      setBulkIndex((i) => i + 1);
      return;
    }
    enqueueClosetSaves(
      bulkItems.map((item) => {
        const parsed = parseFloat(item.costText.replace(/,/g, ""));
        const parsedWears = parseInt(item.wearsText, 10);
        return {
          name: item.name.trim(),
          brand: item.brand.trim(),
          cost: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
          wears:
            Number.isFinite(parsedWears) && parsedWears >= 0 ? parsedWears : 0,
          // Prefer the copy already uploaded for the phone request over
          // re-uploading the local image.
          localUri: (item.bgRemoved ? item.uri : item.uploadedUrl || item.uri) || null,
          category: item.category ?? null,
          // The phone didn't answer (or this is Android) — flag it so an
          // iOS device removes the background via the silent-push queue.
          needsBgRemoval:
            !!item.uri && !item.bgRemoved && !subjectLiftAvailable(),
        };
      }),
    );
    router.back();
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

  // ── Phase: processing (background removal in progress) ───────────────────
  if (phase === "processing") {
    const done = bulkItems.filter((item) => !item.processingBg).length;
    return (
      <ThemedView style={styles.processingPage}>
        <ActivityIndicator size="large" />
        <ThemedText type="subtitle" style={styles.processingTitle}>
          Removing backgrounds…
        </ThemedText>
        <ThemedText style={styles.processingSub}>
          {bulkItems.length > 1
            ? `${done} of ${bulkItems.length} photos done`
            : "This takes a few seconds"}
        </ThemedText>
      </ThemedView>
    );
  }

  // ── Phase: review cutouts ─────────────────────────────────────────────────
  if (phase === "review") {
    return (
      <ThemedView style={styles.reviewPage}>
        <ThemedText type="subtitle" style={styles.reviewTitle}>
          Check the results
        </ThemedText>
        <ThemedText style={styles.reviewSubtitle}>
          Crop, retake, or remove any photo where the background didn’t come out right.
        </ThemedText>
        <ScrollView contentContainerStyle={styles.reviewGrid}>
          {bulkItems.map((item, index) => (
            <View key={item.uri} style={styles.reviewCell}>
              <Image
                source={{ uri: item.uri }}
                style={styles.reviewImage}
                contentFit="contain"
              />
              {item.processingBg && (
                <View style={styles.reviewProcessingOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              <View style={styles.reviewCellActions}>
                <Pressable
                  onPress={() => cropReviewItem(index, item.uri)}
                  disabled={item.processingBg}
                  hitSlop={6}
                  style={[styles.reviewActionBtn, item.processingBg && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Crop this photo"
                >
                  <Ionicons name="crop-outline" size={14} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => retakeReviewPhoto(index)}
                  disabled={item.processingBg}
                  hitSlop={6}
                  style={[styles.reviewActionBtn, item.processingBg && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Retake this photo"
                >
                  <Ionicons name="camera-outline" size={14} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => removeReviewItem(index)}
                  disabled={item.processingBg}
                  hitSlop={6}
                  style={[styles.reviewActionBtn, item.processingBg && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this photo"
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => { setBulkIndex(0); setPhase("editing"); }}
          style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Fill in details"
        >
          <ThemedText style={styles.nextBtnLabel} lightColor="#fff" darkColor="#fff">
            Fill in details
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => { setBulkItems([]); setPhase("pick"); }}
          style={styles.cancelLink}
        >
          <ThemedText type="link" style={styles.reviewCancel}>Cancel</ThemedText>
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
              />
              <TextInput
                accessibilityLabel="Item name"
                placeholder="Name"
                placeholderTextColor={placeholderColor}
                value={current.name}
                onChangeText={(v) => updateField("name", v)}
                style={inputCompact}
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
            onAddCategory={handleAddCategory}
          />

          <Pressable
            onPress={onNext}
            disabled={current.processingBg}
            style={({ pressed }) => [
              styles.nextBtn,
              pressed && { opacity: 0.85 },
              current.processingBg && { opacity: 0.6 },
            ]}
          >
            <ThemedText style={styles.nextBtnLabel} lightColor="#fff" darkColor="#fff">
              {isLast
                ? bulkItems.length > 1
                  ? `Save all ${bulkItems.length} items`
                  : "Save item"
                : "Next →"}
            </ThemedText>
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

  // ── Processing page ────────────────────────────────────────────────
  processingPage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 32,
  },
  processingTitle: { textAlign: "center" },
  processingSub: { textAlign: "center", opacity: 0.55, fontSize: 14 },

  // ── Review page ────────────────────────────────────────────────────
  reviewPage: {
    flex: 1,
    padding: 16,
    paddingBottom: 24,
    gap: 8,
  },
  reviewTitle: { textAlign: "center" },
  reviewSubtitle: {
    textAlign: "center",
    opacity: 0.55,
    fontSize: 14,
    marginBottom: 8,
  },
  reviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    paddingBottom: 12,
  },
  reviewCell: {
    width: "47%",
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: "rgba(128,128,128,0.15)",
    overflow: "hidden",
  },
  reviewImage: {
    width: "100%",
    height: "100%",
  },
  reviewProcessingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  reviewCellActions: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    gap: 6,
  },
  reviewActionBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  reviewCancel: { textAlign: "center" },

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
