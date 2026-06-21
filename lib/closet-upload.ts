import { getSupabase } from "@/supabase-client";

export const CLOSET_IMAGE_BUCKET = "closet-images";

export async function uploadClosetItemImage(
  localUri: string,
  userId?: string | null,
): Promise<string> {
  const supabase = getSupabase();

  let blob: Blob;
  if (localUri.startsWith("data:")) {
    // Parse data URI directly to avoid fetch issues with data: scheme
    const [header, base64Data] = localUri.split(",");
    const mimeType = header.split(":")[1]?.split(";")[0] ?? "image/png";
    const byteString = atob(base64Data);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: mimeType });
  } else {
    const response = await fetch(localUri);
    blob = await response.blob();
  }

  const ext = blob.type?.split("/")[1]?.split("+")[0] || "jpg";
  const path = `${userId ?? "anon"}/${crypto.randomUUID()}.${ext}`;

  console.log("UPLOAD DEBUG:", {
    bucket: CLOSET_IMAGE_BUCKET,
    userId,
    path,
    blobType: blob.type,
  });

  const { data, error } = await supabase.storage
    .from(CLOSET_IMAGE_BUCKET)
    .upload(path, blob, {
      contentType: blob.type || "image/jpeg",
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