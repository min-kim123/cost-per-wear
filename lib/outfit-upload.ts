import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { getSupabase } from "@/lib/supabase-client";

export const OUTFIT_PHOTO_BUCKET = "outfit-photos";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Upload a local photo URI to Supabase Storage and return the public URL. */
export async function uploadOutfitPhoto(
  localUri: string,
  userId?: string | null,
): Promise<string> {
  const supabase = getSupabase();

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

  const { data, error } = await supabase.storage
    .from(OUTFIT_PHOTO_BUCKET)
    .upload(path, uploadBody, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage
    .from(OUTFIT_PHOTO_BUCKET)
    .getPublicUrl(data.path);

  return pub.publicUrl;
}

/**
 * Delete an outfit photo from Supabase Storage given its public URL.
 * Silently ignores URLs that don't belong to the outfit-photos bucket.
 */
export async function deleteOutfitPhoto(photoUrl: string): Promise<void> {
  const marker = `/storage/v1/object/public/${OUTFIT_PHOTO_BUCKET}/`;
  const idx = photoUrl.indexOf(marker);
  if (idx === -1) return; // not a storage URL we manage (e.g. old local file path)

  const storagePath = photoUrl.slice(idx + marker.length);
  await getSupabase().storage.from(OUTFIT_PHOTO_BUCKET).remove([storagePath]);
}
