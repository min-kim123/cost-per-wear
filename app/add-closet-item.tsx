import { uploadClosetItemImage } from "@/lib/closet-upload";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
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

type BulkItem = {
  uri: string;
  brand: string;
  name: string;
  costText: string;
  wearsText: string;
};

export default function AddClosetItemScreen() {
  const router = useRouter();

  // ── Single-item state ──────────────────────────────────────────────
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [costText, setCostText] = useState("");
  const [wearsText, setWearsText] = useState("");
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  // ── Bulk-import state ──────────────────────────────────────────────
  const [bulkItems, setBulkItems] = useState<BulkItem[] | null>(null);
  const [bulkIndex, setBulkIndex] = useState(0);
  const [bulkCapturing, setBulkCapturing] = useState(false);
  const [pendingUris, setPendingUris] = useState<string[]>([]);

  const nameRef = useRef<TextInput>(null);
  const costRef = useRef<TextInput>(null);
  const wearsRef = useRef<TextInput>(null);

  // ── Web paste ─────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUri = ev.target?.result as string;
            if (dataUri) setPickedUri(dataUri);
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#EFEFF4" }, "background");

  const inputStyle = [
    styles.input,
    { color: textColor, borderColor, backgroundColor: inputBackground },
  ];
  const inputStyleCompact = [
    styles.inputCompact,
    { color: textColor, borderColor, backgroundColor: inputBackground },
  ];

  // ── Single-item picker ────────────────────────────────────────────
  const runPicker = async (mode: "camera" | "library") => {
    if (picking || saving) return;
    setPicking(true);
    try {
      if (mode === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Camera access", "Allow camera access in Settings to take a photo.");
          return;
        }
        const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) setPickedUri(result.assets[0].uri);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Photo library", "Allow photo library access in Settings to choose a picture.");
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) setPickedUri(result.assets[0].uri);
      }
    } catch (e) {
      Alert.alert("Photo", e instanceof Error ? e.message : "Could not open camera or photo library.");
    } finally {
      setPicking(false);
    }
  };

  const pasteFromClipboard = async () => {
    if (picking || saving) return;
    setPicking(true);
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (!hasImage) { Alert.alert("No image", "There is no image in your clipboard."); return; }
      const result = await Clipboard.getImageAsync({ format: "png" });
      if (!result?.data) { Alert.alert("Paste failed", "Could not read image from clipboard."); return; }
      if (Platform.OS === "web") {
        const dataUri = result.data.startsWith("data:") ? result.data : `data:image/png;base64,${result.data}`;
        setPickedUri(dataUri);
      } else {
        const uri = `${FileSystem.cacheDirectory}clipboard-${Date.now()}.png`;
        await FileSystem.writeAsStringAsync(uri, result.data, { encoding: FileSystem.EncodingType.Base64 });
        setPickedUri(uri);
      }
    } catch (e) {
      Alert.alert("Paste failed", e instanceof Error ? e.message : "Could not read image from clipboard.");
    } finally {
      setPicking(false);
    }
  };

  // ── Single-item save ──────────────────────────────────────────────
  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert("Name required", "Enter a name for this item."); return; }
    const parsed = parseFloat(costText.replace(/,/g, ""));
    const cost = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const parsedWears = parseInt(wearsText, 10);
    const wears = Number.isFinite(parsedWears) && parsedWears >= 0 ? parsedWears : 0;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      let image: string | null = null;
      if (pickedUri) image = await uploadClosetItemImage(pickedUri, user?.id);
      const { error } = await supabase.from("closet").insert({
        name: trimmed, brand: brand.trim(), cost: Number(cost), wears, image, user_id: user?.id,
      });
      if (error) throw new Error(error.message);
      router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  // ── Bulk: start from library (multiple select) ────────────────────
  const startBulkLibrary = async () => {
    if (picking || saving) return;
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
        setBulkItems(result.assets.map((a) => ({ uri: a.uri, brand: "", name: "", costText: "", wearsText: "" })));
        setBulkIndex(0);
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not open library.");
    } finally {
      setPicking(false);
    }
  };

  // ── Bulk: start from camera ───────────────────────────────────────
  const startBulkCamera = async () => {
    if (picking || saving) return;
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
        setBulkCapturing(true);
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

  const startBulkEditing = () => {
    if (pendingUris.length === 0) return;
    setBulkItems(pendingUris.map((uri) => ({ uri, brand: "", name: "", costText: "", wearsText: "" })));
    setBulkIndex(0);
    setBulkCapturing(false);
    setPendingUris([]);
  };

  const cancelBulk = () => {
    setBulkItems(null);
    setBulkIndex(0);
    setBulkCapturing(false);
    setPendingUris([]);
  };

  const updateBulkField = (field: keyof Omit<BulkItem, "uri">, value: string) => {
    if (!bulkItems) return;
    const updated = [...bulkItems];
    updated[bulkIndex] = { ...updated[bulkIndex], [field]: value };
    setBulkItems(updated);
  };

  // ── Bulk: next / save all ─────────────────────────────────────────
  const onBulkNext = async () => {
    if (!bulkItems) return;
    const current = bulkItems[bulkIndex];
    if (!current.name.trim()) { Alert.alert("Name required", "Enter a name for this item."); return; }

    if (bulkIndex < bulkItems.length - 1) {
      setBulkIndex((i) => i + 1);
      return;
    }

    // Save all
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
          name: item.name.trim(), brand: item.brand.trim(),
          cost: Number(cost), wears, image, user_id: user?.id,
        });
      }
      cancelBulk();
      router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  // ── Render: bulk capturing phase ──────────────────────────────────
  if (bulkCapturing) {
    return (
      <ThemedView style={styles.bulkCapture}>
        <ThemedText type="subtitle" style={styles.bulkCaptureTitle}>
          {pendingUris.length} photo{pendingUris.length !== 1 ? "s" : ""} taken
        </ThemedText>
        <View style={styles.bulkCaptureThumbRow}>
          {pendingUris.slice(-4).map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.bulkCapThumb} contentFit="cover" />
          ))}
        </View>
        <Pressable
          onPress={takeBulkPhoto}
          disabled={picking}
          style={({ pressed }) => [
            styles.bulkCaptureBtn,
            { borderColor, backgroundColor: inputBackground },
            pressed && { opacity: 0.8 },
            picking && { opacity: 0.5 },
          ]}
        >
          <Ionicons name="camera-outline" size={22} color={textColor} />
          <ThemedText style={styles.bulkCaptureBtnLabel}>Take another</ThemedText>
        </Pressable>
        <Pressable
          onPress={startBulkEditing}
          disabled={pendingUris.length === 0}
          style={({ pressed }) => [
            styles.bulkStartEditBtn,
            pressed && { opacity: 0.85 },
            pendingUris.length === 0 && { opacity: 0.45 },
          ]}
        >
          <ThemedText style={styles.bulkStartEditLabel} lightColor="#fff" darkColor="#fff">
            Done — fill in details →
          </ThemedText>
        </Pressable>
        <Pressable onPress={cancelBulk} style={styles.bulkCancelLink}>
          <ThemedText type="link">Cancel</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  // ── Render: bulk editing wizard ───────────────────────────────────
  if (bulkItems !== null) {
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
        <ThemedView style={styles.bulkWizard}>
          {/* Header */}
          <View style={styles.bulkProgressHeader}>
            <ThemedText style={styles.bulkProgressLabel}>
              Item {bulkIndex + 1} of {bulkItems.length}
            </ThemedText>
            <Pressable onPress={cancelBulk}>
              <ThemedText type="link" style={styles.bulkCancelInline}>Cancel</ThemedText>
            </Pressable>
          </View>
          <View style={[styles.progressTrack, { borderColor }]}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>

          {/* Image + form side by side */}
          <View style={styles.bulkRow}>
            <Image
              source={{ uri: current.uri }}
              style={styles.bulkPreview}
              contentFit="cover"
            />
            <View style={styles.bulkFields}>
              <BrandInput
                value={current.brand}
                onChange={(v) => updateBulkField("brand", v)}
                editable={!saving}
              />
              <TextInput
                accessibilityLabel="Item name"
                placeholder="Name *"
                placeholderTextColor={placeholderColor}
                value={current.name}
                onChangeText={(v) => updateBulkField("name", v)}
                style={inputStyleCompact}
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
                onChangeText={(v) => updateBulkField("costText", v)}
                keyboardType="numbers-and-punctuation"
                style={inputStyleCompact}
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
                onChangeText={(v) => updateBulkField("wearsText", v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                style={inputStyleCompact}
                editable={!saving}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>

          <Pressable
            onPress={onBulkNext}
            disabled={saving}
            style={({ pressed }) => [
              styles.bulkNextBtn,
              pressed && { opacity: 0.85 },
              saving && { opacity: 0.6 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.bulkNextLabel} lightColor="#fff" darkColor="#fff">
                {isLast ? `Save all ${bulkItems.length} items` : "Next →"}
              </ThemedText>
            )}
          </Pressable>
        </ThemedView>
      </KeyboardAwareScrollView>
    );
  }

  // ── Render: normal single-item form ───────────────────────────────
  return (
    <KeyboardAwareScrollView
      style={styles.flex}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scrollContent}
      enableOnAndroid
      extraScrollHeight={Platform.OS === "ios" ? 20 : 80}
    >
      <ThemedView style={styles.container}>
        {/* Bulk import section */}
        <View style={styles.bulkSection}>
          <ThemedText type="defaultSemiBold" style={styles.bulkSectionTitle}>
            Import multiple items
          </ThemedText>
          <View style={styles.bulkSectionBtns}>
            <Pressable
              onPress={startBulkLibrary}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.bulkSectionBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && { opacity: 0.8 },
                (picking || saving) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="images-outline" size={18} color={textColor} />
              <ThemedText style={styles.bulkSectionBtnLabel}>Library</ThemedText>
            </Pressable>
            <Pressable
              onPress={startBulkCamera}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.bulkSectionBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && { opacity: 0.8 },
                (picking || saving) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="camera-outline" size={18} color={textColor} />
              <ThemedText style={styles.bulkSectionBtnLabel}>Camera</ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: borderColor }]} />

        {/* Single item form */}
        <View style={styles.photoRow}>
          <View
            style={[styles.previewWrap, { borderColor }]}
            accessibilityLabel={pickedUri ? "Selected item photo" : "Item photo preview"}
          >
            {pickedUri ? (
              <Image source={{ uri: pickedUri }} style={styles.previewImage} contentFit="cover" />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons name="image-outline" size={32} color={placeholderColor} />
              </View>
            )}
          </View>
          <View style={styles.photoActions}>
            <Pressable
              onPress={() => runPicker("camera")}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.photoBtn, { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed, (picking || saving) && styles.photoBtnDisabled,
              ]}
              accessibilityRole="button" accessibilityLabel="Take photo"
            >
              <Ionicons name="camera-outline" size={20} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Camera</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => runPicker("library")}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.photoBtn, { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed, (picking || saving) && styles.photoBtnDisabled,
              ]}
              accessibilityRole="button" accessibilityLabel="Choose from library"
            >
              <Ionicons name="images-outline" size={20} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Library</ThemedText>
            </Pressable>
            <Pressable
              onPress={pasteFromClipboard}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.photoBtn, { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed, (picking || saving) && styles.photoBtnDisabled,
              ]}
              accessibilityRole="button" accessibilityLabel="Paste image from clipboard"
            >
              <Ionicons name="clipboard-outline" size={20} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Paste</ThemedText>
            </Pressable>
            {pickedUri ? (
              <Pressable
                onPress={() => setPickedUri(null)}
                disabled={saving}
                style={styles.clearPhoto}
                accessibilityRole="button" accessibilityLabel="Remove photo"
              >
                <ThemedText type="link" style={styles.clearPhotoText}>Remove Photo</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>

        <ThemedText type="defaultSemiBold" style={styles.label}>Brand</ThemedText>
        <BrandInput value={brand} onChange={setBrand} editable={!saving} />
        <ThemedText type="defaultSemiBold" style={styles.label}>Name</ThemedText>
        <TextInput
          accessibilityLabel="Item name"
          placeholder="e.g. Navy chinos"
          placeholderTextColor={placeholderColor}
          value={name}
          onChangeText={setName}
          style={inputStyle}
          editable={!saving}
          returnKeyType="next"
          onSubmitEditing={() => costRef.current?.focus()}
        />
        <ThemedText type="defaultSemiBold" style={styles.label}>Cost ($)</ThemedText>
        <TextInput
          ref={costRef}
          accessibilityLabel="Item cost in dollars"
          placeholder="0"
          placeholderTextColor={placeholderColor}
          value={costText}
          onChangeText={setCostText}
          keyboardType="decimal-pad"
          style={inputStyle}
          editable={!saving}
          returnKeyType="next"
          onSubmitEditing={() => wearsRef.current?.focus()}
        />
        <ThemedText type="defaultSemiBold" style={styles.label}>Previous wears</ThemedText>
        <TextInput
          ref={wearsRef}
          accessibilityLabel="Number of times already worn"
          placeholder="0"
          placeholderTextColor={placeholderColor}
          value={wearsText}
          onChangeText={(v) => setWearsText(v.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          style={inputStyle}
          editable={!saving}
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />

        <Pressable
          onPress={onSave}
          disabled={saving || picking}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && styles.saveBtnPressed,
            (saving || picking) && styles.saveBtnDisabled,
          ]}
          accessibilityRole="button" accessibilityLabel="Save clothing item"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.saveBtnText} lightColor="#fff" darkColor="#fff">
              Save item
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  container: { flex: 1, padding: 20, paddingBottom: 32, gap: 8 },

  // ── Bulk section (top of normal form) ───────────────────────────
  bulkSection: { gap: 8 },
  bulkSectionTitle: { opacity: 0.7, fontSize: 13 },
  bulkSectionBtns: { flexDirection: "row", gap: 10 },
  bulkSectionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
  },
  bulkSectionBtnLabel: { fontSize: 14, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, opacity: 0.4, marginVertical: 4 },

  // ── Bulk capturing phase ─────────────────────────────────────────
  bulkCapture: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    padding: 32,
  },
  bulkCaptureTitle: { textAlign: "center" },
  bulkCaptureThumbRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  bulkCapThumb: {
    width: 70,
    height: 93,
    borderRadius: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
  },
  bulkCaptureBtn: {
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
  bulkCaptureBtnLabel: { fontSize: 16, fontWeight: "600" },
  bulkStartEditBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#ffb361",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    paddingHorizontal: 24,
  },
  bulkStartEditLabel: { fontSize: 16, fontWeight: "700" },
  bulkCancelLink: { paddingVertical: 8 },

  // ── Bulk wizard ──────────────────────────────────────────────────
  bulkWizard: { flex: 1, padding: 16, paddingBottom: 24, gap: 10 },
  bulkProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bulkProgressLabel: { fontSize: 14, fontWeight: "600" },
  bulkCancelInline: { fontSize: 14 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#ffb361",
    borderRadius: 2,
  },
  bulkRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  bulkPreview: {
    width: 110,
    aspectRatio: 3 / 4,
    borderRadius: 10,
    backgroundColor: "rgba(128,128,128,0.15)",
    flexShrink: 0,
  },
  bulkFields: { flex: 1, gap: 8 },
  bulkNextBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#ffb361",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  bulkNextLabel: { fontSize: 16, fontWeight: "700" },

  // ── Normal single-item form ──────────────────────────────────────
  label: { marginTop: 12 },
  photoRow: { flexDirection: "row", gap: 10, marginTop: 4, alignItems: "stretch" },
  previewWrap: {
    borderWidth: 1, borderRadius: 12, overflow: "hidden",
    aspectRatio: 3 / 4, width: 160, flexShrink: 0,
  },
  previewImage: { width: "100%", height: "100%" },
  previewPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  photoActions: { flex: 1, flexDirection: "column", gap: 8, justifyContent: "center" },
  photoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 54, borderRadius: 10, borderWidth: 1,
  },
  photoBtnLabel: { fontSize: 14, fontWeight: "600" },
  photoBtnPressed: { opacity: 0.85 },
  photoBtnDisabled: { opacity: 0.5 },
  clearPhoto: { alignSelf: "center", paddingVertical: 2 },
  clearPhotoText: { fontSize: 13 },
  input: {
    height: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16,
  },
  inputCompact: {
    height: 38, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 14,
  },
  saveBtn: {
    marginTop: 28, height: 48, borderRadius: 10, backgroundColor: "#0a7ea4",
    alignItems: "center", justifyContent: "center",
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: "600" },
});
