import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

// `dataUrl` is a base64 data URL (e.g. "data:image/png;base64,...") as returned
// by expo-clipboard. FileSystem writes aren't available on web, and a data URL
// works fine there directly; on native we write it to a local cache file so
// callers only ever pass around short URIs (e.g. through router params).
export async function writeClipboardImageToLocalUri(dataUrl: string): Promise<string> {
  if (Platform.OS === "web") return dataUrl;

  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  const dest = `${FileSystem.cacheDirectory}clipboard-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(dest, base64, { encoding: "base64" });
  return dest;
}
