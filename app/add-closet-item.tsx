import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
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

export default function AddClosetItemScreen() {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [costText, setCostText] = useState("");
  const [wearsText, setWearsText] = useState("");
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

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

  const runPicker = async (mode: "camera" | "library") => {
    if (picking || saving) return;
    setPicking(true);
    try {
      if (mode === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Camera access",
            "Allow camera access in Settings to take a photo.",
          );
          return;
        }
        const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) {
          setPickedUri(result.assets[0].uri);
        }
      } else {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Photo library",
            "Allow photo library access in Settings to choose a picture.",
          );
          return;
        }
        const result =
          await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
        if (!result.canceled && result.assets[0]?.uri) {
          setPickedUri(result.assets[0].uri);
        }
      }
    } catch (e) {
      Alert.alert(
        "Photo",
        e instanceof Error
          ? e.message
          : "Could not open camera or photo library.",
      );
    } finally {
      setPicking(false);
    }
  };

  const pasteFromClipboard = async () => {
    if (picking || saving) return;
    setPicking(true);
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (!hasImage) {
        Alert.alert("No image", "There is no image in your clipboard.");
        return;
      }
      const result = await Clipboard.getImageAsync({ format: "png" });
      if (!result?.data) {
        Alert.alert("Paste failed", "Could not read image from clipboard.");
        return;
      }
      if (Platform.OS === "web") {
        // On web, expo-clipboard returns a full data URI already
        const dataUri = result.data.startsWith("data:")
          ? result.data
          : `data:image/png;base64,${result.data}`;
        setPickedUri(dataUri);
      } else {
        const uri = `${FileSystem.cacheDirectory}clipboard-${Date.now()}.png`;
        await FileSystem.writeAsStringAsync(uri, result.data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setPickedUri(uri);
      }
    } catch (e) {
      Alert.alert(
        "Paste failed",
        e instanceof Error ? e.message : "Could not read image from clipboard.",
      );
    } finally {
      setPicking(false);
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

      let image: string | null = null;
      if (pickedUri) {
        image = await uploadClosetItemImage(pickedUri, user?.id);
      }

      const { error } = await supabase.from("closet").insert({
        name: trimmed,
        brand: brand.trim(),
        cost: Number(cost),
        wears,
        image,
        user_id: user?.id,
      });

      if (error) {
        throw new Error(error.message);
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

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <ThemedView style={styles.container}>
          <ThemedText type="defaultSemiBold" style={styles.label}>
            Photo
          </ThemedText>
          <View
            style={[styles.previewWrap, { borderColor }]}
            accessibilityLabel={
              pickedUri ? "Selected item photo" : "Item photo preview"
            }
          >
            {pickedUri ? (
              <Image
                source={{ uri: pickedUri }}
                style={styles.previewImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons
                  name="image-outline"
                  size={40}
                  color={placeholderColor}
                />
                <ThemedText style={[styles.previewHint, { opacity: 0.65 }]}>
                  Use Camera, Library, or Paste below (optional)
                </ThemedText>
              </View>
            )}
          </View>
          <View style={styles.photoActions}>
            <Pressable
              onPress={() => runPicker("camera")}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed,
                (picking || saving) && styles.photoBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
            >
              <Ionicons name="camera-outline" size={22} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Camera</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => runPicker("library")}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed,
                (picking || saving) && styles.photoBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
            >
              <Ionicons name="images-outline" size={22} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Library</ThemedText>
            </Pressable>
            <Pressable
              onPress={pasteFromClipboard}
              disabled={picking || saving}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor, backgroundColor: inputBackground },
                pressed && styles.photoBtnPressed,
                (picking || saving) && styles.photoBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Paste image from clipboard"
            >
              <Ionicons name="clipboard-outline" size={22} color={textColor} />
              <ThemedText style={styles.photoBtnLabel}>Paste</ThemedText>
            </Pressable>
          </View>
          {pickedUri ? (
            <Pressable
              onPress={() => setPickedUri(null)}
              disabled={saving}
              style={styles.clearPhoto}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
            >
              <ThemedText type="link" style={styles.clearPhotoText}>
                Remove photo
              </ThemedText>
            </Pressable>
          ) : null}

          <ThemedText type="defaultSemiBold" style={styles.label}>
            Brand
          </ThemedText>
          <BrandInput value={brand} onChange={setBrand} editable={!saving} />
          <ThemedText type="defaultSemiBold" style={styles.label}>
            Name
          </ThemedText>
          <TextInput
            accessibilityLabel="Item name"
            placeholder="e.g. Navy chinos"
            placeholderTextColor={placeholderColor}
            value={name}
            onChangeText={setName}
            style={inputStyle}
            editable={!saving}
          />
          <ThemedText type="defaultSemiBold" style={styles.label}>
            Cost ($)
          </ThemedText>
          <TextInput
            accessibilityLabel="Item cost in dollars"
            placeholder="0"
            placeholderTextColor={placeholderColor}
            value={costText}
            onChangeText={setCostText}
            keyboardType="decimal-pad"
            style={inputStyle}
            editable={!saving}
          />
          <ThemedText type="defaultSemiBold" style={styles.label}>
            Previous wears
          </ThemedText>
          <TextInput
            accessibilityLabel="Number of times already worn"
            placeholder="0"
            placeholderTextColor={placeholderColor}
            value={wearsText}
            onChangeText={(v) => setWearsText(v.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            style={inputStyle}
            editable={!saving}
          />

          <Pressable
            onPress={onSave}
            disabled={saving || picking}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && styles.saveBtnPressed,
              (saving || picking) && styles.saveBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save clothing item"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText
                style={styles.saveBtnText}
                lightColor="#fff"
                darkColor="#fff"
              >
                Save item
              </ThemedText>
            )}
          </Pressable>
        </ThemedView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
  },
  label: {
    marginTop: 12,
  },
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
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  previewHint: {
    fontSize: 14,
    textAlign: "center",
  },
  photoActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
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
  photoBtnLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  photoBtnPressed: {
    opacity: 0.85,
  },
  photoBtnDisabled: {
    opacity: 0.5,
  },
  clearPhoto: {
    alignSelf: "center",
    marginTop: 6,
    paddingVertical: 4,
  },
  clearPhotoText: {
    fontSize: 15,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  saveBtn: {
    marginTop: 28,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#0a7ea4",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnPressed: {
    opacity: 0.85,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
