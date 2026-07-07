import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { getSupabase } from "@/lib/supabase-client";

async function readAsBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return dataUri.split(",")[1] ?? "";
  }
  if (uri.startsWith("data:")) {
    return uri.split(",")[1] ?? "";
  }
  return FileSystem.readAsStringAsync(uri, { encoding: "base64" });
}

async function writeResultImage(base64: string): Promise<string> {
  if (Platform.OS === "web") {
    return `data:image/png;base64,${base64}`;
  }
  const uri = `${FileSystem.cacheDirectory}bg-removed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: "base64" });
  return uri;
}

/**
 * Sends a local photo to the `remove-background` edge function (which proxies to
 * remove.bg) and returns a new local URI for the cutout with a transparent background.
 * Throws on any failure — callers should fall back to the original photo.
 */
export async function removeBackground(localUri: string): Promise<string> {
  const imageBase64 = await readAsBase64(localUri);
  if (!imageBase64) throw new Error("Could not read image data");

  const { data, error } = await getSupabase().functions.invoke("remove-background", {
    body: { imageBase64 },
  });
  if (error) throw new Error(error.message);
  const resultBase64 = data?.image;
  if (!resultBase64) throw new Error("No image returned");

  return writeResultImage(resultBase64);
}
