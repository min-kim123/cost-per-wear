import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getSupabase } from "@/supabase-client";

export const CLOSET_IMAGE_BUCKET = "closet-images";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function uploadClosetItemImage(
  localUri: string,
  userId?: string | null,
): Promise<string> {
  const supabase = getSupabase();

  // On native, Hermes doesn't support creating Blobs from ArrayBuffer/ArrayBufferView
  // and fetch() of file:// URIs returns empty bodies on physical devices.
  // Supabase storage accepts ArrayBuffer directly, so we use that on native.
  let uploadBody: ArrayBuffer | Blob;
  let contentType: string;

  if (Platform.OS !== "web") {
    let base64: string;
    if (localUri.startsWith("data:")) {
      const [header, b64] = localUri.split(",");
      contentType = header.split(":")[1]?.split(";")[0] ?? "image/jpeg";
      base64 = b64;
    } else {
      contentType = "image/jpeg";
      base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: "base64",
      });
    }
    uploadBody = base64ToArrayBuffer(base64);
  } else {
    const response = await fetch(localUri);
    uploadBody = await response.blob();
    contentType = (uploadBody as Blob).type || "image/jpeg";
  }

  const ext = contentType.split("/")[1]?.split("+")[0] || "jpg";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const path = `${userId ?? "anon"}/${uniqueId}.${ext}`;

  console.log("UPLOAD DEBUG:", { bucket: CLOSET_IMAGE_BUCKET, userId, path, contentType });

  const { data, error } = await supabase.storage
    .from(CLOSET_IMAGE_BUCKET)
    .upload(path, uploadBody, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  // ✅ PUBLIC BUCKET FIX: return permanent URL
  const { data: pub } = supabase.storage
    .from(CLOSET_IMAGE_BUCKET)
    .getPublicUrl(data.path);

  return pub.publicUrl;
}