import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { Platform } from "react-native";

/**
 * Best-effort save of a local photo URI to the device camera roll.
 * No-ops on web (no camera roll there) and swallows all errors —
 * this is a nice-to-have side effect, never something a save flow
 * should fail over.
 */
export async function saveToCameraRoll(localUri: string): Promise<void> {
  if (Platform.OS === "web") return;
  if (!localUri || /^https?:\/\//i.test(localUri)) return;

  try {
    let fileUri = localUri;
    // MediaLibrary needs a file:// URI — write data: URIs to a temp file first.
    if (localUri.startsWith("data:")) {
      const [header, base64] = localUri.split(",");
      const ext = header.split(":")[1]?.split(";")[0]?.split("/")[1] ?? "jpg";
      fileUri = `${FileSystem.cacheDirectory}camera-roll-${Date.now()}.${ext}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: "base64" });
    }

    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== "granted") return;
    await MediaLibrary.saveToLibraryAsync(fileUri);
  } catch {
    // Ignore — saving to the camera roll is best-effort.
  }
}
