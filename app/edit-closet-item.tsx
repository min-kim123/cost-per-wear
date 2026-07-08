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
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { BrandInput } from "@/components/brand-input";
import { CategoryPicker, type Category } from "@/components/category-picker";
import { PasteImageButton } from "@/components/paste-image-button";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { requestPhoneBgRemoval } from "@/lib/bg-removal-request";
import { addCategory, DAILY_STACK_CATEGORY_NAME, listCategories } from "@/lib/categories";
import { writeClipboardImageToLocalUri } from "@/lib/clipboard-image";
import { onImageCaptured } from "@/lib/image-capture-bridge";
import { saveToCameraRoll } from "@/lib/save-to-camera-roll";
import { liftSubject, subjectLiftAvailable } from "@/lib/subject-lift";
import { getSupabase } from "@/lib/supabase-client";

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [3, 4],
  quality: 0.85,
};

const PREVIEW_HEIGHT = 284;

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
  const [removingBackground, setRemovingBackground] = useState(false);
  // Waiting on the user's iPhone to answer a paste-time cutout request (web).
  // Unlike removingBackground this doesn't block saving — an unanswered image
  // just gets flagged for the phone queue at save.
  const [waitingForPhone, setWaitingForPhone] = useState(false);
  const [imageAspect, setImageAspect] = useState(3 / 4);
  const [showImageOptions, setShowImageOptions] = useState(false);

  const { width: windowWidth } = useWindowDimensions();
  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#EFEFF4" }, "background");
  const fieldBackground = useThemeColor({ light: "#ffffff" }, "background");

  useEffect(() => {
    if (!id) return;
    const supabase = getSupabase();
    (async () => {
      try {
        const { data, error } = await supabase
          .from("closet")
          .select("id, brand, name, cost, wears, image, created_at, category")
          .eq("id", id)
          .single();
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
      } finally {
        setLoadingItem(false);
      }
    })();
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

      if (!subjectLiftAvailable()) return;
      setRemovingBackground(true);
      liftSubject(uri)
        .then((liftedUri) => {
          setPickedUri((prev) => (prev === uri ? liftedUri : prev));
        })
        .catch(() => {
          // Keep the cropped photo as-is if background removal fails.
        })
        .finally(() => setRemovingBackground(false));
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
          saveToCameraRoll(result.assets[0].uri);
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

  // Tracks the URI that already had its background removed, so onSave doesn't
  // also flag it for the phone-side queue.
  const bgRemovedUriRef = useRef<string | null>(null);
  // Original uploaded for a paste-time phone request — reused at save so the
  // image isn't uploaded twice.
  const uploadedRef = useRef<{ forUri: string; url: string } | null>(null);

  const pasteImage = async (data: string) => {
    const uri = await writeClipboardImageToLocalUri(data);
    setPickedUri(uri);
    setImageCleared(false);

    if (subjectLiftAvailable()) {
      setRemovingBackground(true);
      liftSubject(uri)
        .then((cutoutUri) => {
          bgRemovedUriRef.current = cutoutUri;
          setPickedUri((prev) => (prev === uri ? cutoutUri : prev));
        })
        .catch(() => {
          // Keep the pasted photo as-is if background removal fails.
        })
        .finally(() => setRemovingBackground(false));
      return;
    }
    if (Platform.OS !== "web") return;

    // Web: upload now and ask the user's iPhone to cut out the subject; swap
    // in the result when it lands. No answer → flagged at save instead.
    setWaitingForPhone(true);
    try {
      const { sourceUrl, result } = await requestPhoneBgRemoval(uri);
      uploadedRef.current = { forUri: uri, url: sourceUrl };
      const cutoutUrl = await result;
      if (cutoutUrl) {
        bgRemovedUriRef.current = cutoutUrl;
        setPickedUri((prev) => (prev === uri ? cutoutUrl : prev));
      }
    } catch {
      // Keep the pasted photo as-is; the phone-side queue catches it later.
    } finally {
      setWaitingForPhone(false);
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
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
        // Reuse the copy uploaded at paste time if the image hasn't changed.
        image =
          uploadedRef.current?.forUri === pickedUri
            ? uploadedRef.current.url
            : await uploadClosetItemImage(pickedUri, user?.id);
      } else if (imageCleared) {
        image = null;
      } else {
        image = existingImageUrl;
      }

      const enteringDailyStack =
        category === DAILY_STACK_CATEGORY_NAME && originalCategory !== DAILY_STACK_CATEGORY_NAME;
      const leavingDailyStack =
        category !== DAILY_STACK_CATEGORY_NAME && originalCategory === DAILY_STACK_CATEGORY_NAME;

      // New photo attached with no cutout on it yet (the phone hasn't
      // answered, or this is Android) — flag it so an iOS device removes the
      // background via the silent-push queue.
      const needsBgRemoval =
        !!pickedUri &&
        pickedUri !== bgRemovedUriRef.current &&
        !subjectLiftAvailable();

      const { error } = await supabase
        .from("closet")
        .update({
          name: trimmed,
          brand: brand.trim(),
          cost,
          wears,
          image,
          category: category ?? null,
          ...(needsBgRemoval ? { needs_bg_removal: true } : {}),
          ...(enteringDailyStack ? { daily_stack_since: new Date().toISOString() } : {}),
          ...(leavingDailyStack ? { daily_stack_since: null } : {}),
        })
        .eq("id", id);

      if (error) throw new Error(error.message);
      if (needsBgRemoval) {
        supabase.functions.invoke("notify-bg-removal").catch(() => {});
      }
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

  const handleAddCategory = async (name: string) => {
    const created = await addCategory(name);
    setCategories((prev) => [...prev, created.name]);
    return created.name;
  };

  const closeMenu = () => {
    if (deleting) return;
    setShowMenu(false);
    setConfirmingDelete(false);
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
      setShowMenu(false);
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
  const busy = saving || deleting || picking || removingBackground;

  // Reset to the fallback aspect while a newly selected photo's real size loads
  useEffect(() => {
    setImageAspect(3 / 4);
  }, [displayUri]);

  // Screen width minus page padding
  const maxPreviewWidth = windowWidth - 16 * 2;

  const inputCompact = [
    styles.inputCompact,
    { color: textColor, borderColor, backgroundColor: fieldBackground },
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
      <Modal
        visible={showMenu}
        transparent
        animationType="slide"
        onRequestClose={closeMenu}
      >
        <Pressable
          style={styles.menuOverlay}
          onPress={closeMenu}
        >
          <View style={styles.menuSheet}>
            <View style={styles.menuHandle} />

            {confirmingDelete ? (
              <>
                <ThemedText style={styles.confirmText}>
                  Permanently delete this item?
                </ThemedText>

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

                <Pressable
                  style={({ pressed }) => [styles.menuCancel, pressed && { opacity: 0.7 }]}
                  onPress={closeMenu}
                  disabled={deleting}
                >
                  <ThemedText style={styles.menuCancelText}>Cancel</ThemedText>
                </Pressable>
              </>
            ) : (
              <>
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
                  onPress={() => setConfirmingDelete(true)}
                >
                  <Ionicons name="trash-outline" size={22} color="#C00" />
                  <ThemedText style={[styles.menuItemText, { color: "#C00" }]}>Delete</ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.menuCancel, pressed && { opacity: 0.7 }]}
                  onPress={closeMenu}
                >
                  <ThemedText style={styles.menuCancelText}>Cancel</ThemedText>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <ThemedView style={styles.page}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color="#666" />
        </Pressable>

        <Pressable
          onPress={() => setShowMenu(true)}
          disabled={busy}
          style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#666" />
        </Pressable>

        {/* ── Image + fields ─────────────────────────────────────── */}
        <View style={styles.mainCol}>
          {/* Image column */}
          <View style={styles.imageCol}>
            <View style={styles.previewWrap}>
              {displayUri ? (
                <Image
                  source={{ uri: displayUri }}
                  style={[
                    styles.preview,
                    {
                      height: PREVIEW_HEIGHT,
                      width: Math.min(PREVIEW_HEIGHT * imageAspect, maxPreviewWidth),
                    },
                  ]}
                  contentFit="contain"
                  onLoad={(e) => {
                    const { width, height } = e.source;
                    if (width && height) setImageAspect(width / height);
                  }}
                />
              ) : (
                <View
                  style={[
                    styles.preview,
                    styles.previewPlaceholder,
                    { height: PREVIEW_HEIGHT, width: PREVIEW_HEIGHT * (3 / 4), borderColor },
                  ]}
                >
                  <Ionicons name="image-outline" size={32} color={placeholderColor} />
                </View>
              )}
              {removingBackground || waitingForPhone ? (
                <View style={styles.previewOverlay}>
                  <ActivityIndicator color="#fff" />
                  <ThemedText style={styles.previewOverlayText} lightColor="#fff" darkColor="#fff">
                    Removing background…
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.imageOptionsAnchor}>
                <Pressable
                  onPress={() => setShowImageOptions((v) => !v)}
                  disabled={busy}
                  style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                  accessibilityRole="button"
                  accessibilityLabel={showImageOptions ? "Hide photo options" : "Edit photo"}
                >
                  <Ionicons
                    name={showImageOptions ? "chevron-up" : "pencil"}
                    size={16}
                    color={textColor}
                  />
                </Pressable>
                {showImageOptions ? (
                  <View style={styles.imageOptionsMenu}>
                    {displayUri ? (
                      <Pressable
                        onPress={() => {
                          setShowImageOptions(false);
                          router.push({
                            pathname: "/crop-image",
                            params: { uri: displayUri, returnTo: "edit", id },
                          });
                        }}
                        disabled={busy}
                        style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                        accessibilityRole="button"
                        accessibilityLabel="Crop photo"
                      >
                        <Ionicons name="crop-outline" size={16} color={textColor} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => {
                        setShowImageOptions(false);
                        runPicker("camera");
                      }}
                      disabled={busy}
                      style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                      accessibilityRole="button"
                      accessibilityLabel="Take photo"
                    >
                      <Ionicons name="camera-outline" size={16} color={textColor} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setShowImageOptions(false);
                        runPicker("library");
                      }}
                      disabled={busy}
                      style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                      accessibilityRole="button"
                      accessibilityLabel="Choose from library"
                    >
                      <Ionicons name="images-outline" size={16} color={textColor} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setShowImageOptions(false);
                        router.push({
                          pathname: "/web-capture",
                          params: { returnTo: "edit", id },
                        });
                      }}
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
                      onImage={(data) => {
                        setShowImageOptions(false);
                        pasteImage(data);
                      }}
                    >
                      <Ionicons name="clipboard-outline" size={16} color={textColor} />
                    </PasteImageButton>
                    {displayUri ? (
                      <Pressable
                        onPress={() => {
                          setShowImageOptions(false);
                          clearImage();
                        }}
                        disabled={busy}
                        style={[styles.imageBtn, { borderColor, backgroundColor: inputBackground }]}
                        accessibilityRole="button"
                        accessibilityLabel="Remove photo"
                      >
                        <Ionicons name="close-outline" size={16} color="#C00" />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {/* Fields column */}
          <View style={styles.fieldsCol}>
            <View style={[styles.fieldRow, styles.brandFieldRow]}>
              <ThemedText style={styles.fieldLabel}>Brand</ThemedText>
              <View style={styles.fieldInputWrap}>
                <BrandInput
                  value={brand}
                  onChange={setBrand}
                  editable={!busy}
                  compact
                  backgroundColor={fieldBackground}
                />
              </View>
            </View>
            <View style={styles.fieldRow}>
              <ThemedText style={styles.fieldLabel}>Name</ThemedText>
              <TextInput
                accessibilityLabel="Item name"
                placeholder="Required"
                placeholderTextColor={placeholderColor}
                value={name}
                onChangeText={setName}
                style={[inputCompact, styles.fieldInputWrap]}
                editable={!busy}
                returnKeyType="next"
              />
            </View>
            <View style={styles.fieldRow}>
              <ThemedText style={styles.fieldLabel}>Cost</ThemedText>
              <TextInput
                accessibilityLabel="Item cost in dollars"
                placeholder="$0.00"
                placeholderTextColor={placeholderColor}
                value={costText}
                onChangeText={setCostText}
                keyboardType="decimal-pad"
                style={[inputCompact, styles.fieldInputWrap]}
                editable={!busy}
                returnKeyType="next"
              />
            </View>
            <View style={styles.fieldRow}>
              <ThemedText style={styles.fieldLabel}>Wears</ThemedText>
              <TextInput
                accessibilityLabel="Number of times worn"
                placeholder="0"
                placeholderTextColor={placeholderColor}
                value={wearsText}
                onChangeText={(v) => setWearsText(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                style={[inputCompact, styles.fieldInputWrap]}
                editable={!busy}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              <Pressable
                onPress={() =>
                  setWearsText((prev) => {
                    const parsed = parseInt(prev, 10);
                    return String(Math.max((Number.isFinite(parsed) ? parsed : 0) - 1, 0));
                  })
                }
                disabled={busy}
                style={({ pressed }) => [
                  styles.wearsIncrementBtn,
                  { borderColor, backgroundColor: inputBackground },
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Remove one wear"
              >
                <Ionicons name="remove" size={18} color={textColor} />
              </Pressable>
              <Pressable
                onPress={() =>
                  setWearsText((prev) => {
                    const parsed = parseInt(prev, 10);
                    return String((Number.isFinite(parsed) ? parsed : 0) + 1);
                  })
                }
                disabled={busy}
                style={({ pressed }) => [
                  styles.wearsIncrementBtn,
                  { borderColor, backgroundColor: inputBackground },
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add one wear"
              >
                <Ionicons name="add" size={18} color={textColor} />
              </Pressable>
            </View>
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
          onAddCategory={handleAddCategory}
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

      </ThemedView>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { flexGrow: 1 },

  // ── Page ──────────────────────────────────────────────────────────
  page: { flex: 1, padding: 16, paddingTop: 44, paddingBottom: 28, gap: 10 },
  backBtn: {
    position: "absolute",
    top: 14,
    left: 14,
    zIndex: 5,
    padding: 4,
  },
  menuBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 5,
    padding: 4,
  },

  // ── Main column: image on top, fields below ────────────────────────
  mainCol: { gap: 14, alignItems: "center" },

  imageCol: { width: "100%", gap: 6, alignItems: "center" },
  previewWrap: { flexShrink: 0, position: "relative", alignSelf: "center" },
  preview: {
    borderRadius: 10,
    backgroundColor: "rgba(128,128,128,0.15)",
    flexShrink: 0,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 6,
  },
  previewOverlayText: {
    fontSize: 12,
    textAlign: "center",
  },
  previewPlaceholder: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imageOptionsAnchor: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 3,
    alignItems: "flex-end",
    gap: 8,
  },
  imageOptionsMenu: {
    alignItems: "flex-end",
    gap: 8,
  },
  imageBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  fieldsCol: { width: "100%", gap: 8 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandFieldRow: { zIndex: 10 },
  fieldLabel: { width: 48, fontSize: 13, opacity: 0.65 },
  fieldInputWrap: { flex: 1 },
  wearsIncrementBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  inputCompact: {
    height: 30,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 0,
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
  confirmText: {
    fontSize: 14,
    textAlign: "center",
    color: "#C00",
    paddingVertical: 12,
  },
  confirmDeleteBtn: {
    height: 50,
    borderRadius: 12,
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
