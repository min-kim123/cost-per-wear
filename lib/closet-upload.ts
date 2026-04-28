import { getSupabase } from "@/supabase-client";

export const CLOSET_IMAGE_BUCKET = "closet-images";

export async function uploadClosetItemImage(
  localUri: string,
  userId?: string | null,
): Promise<string> {
  const supabase = getSupabase();

  const response = await fetch(localUri);
  const blob = await response.blob();

  const ext = blob.type?.split("/")[1] || "jpg";
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