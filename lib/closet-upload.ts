import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { Image as RNImage, Platform } from "react-native";
import { getSupabase } from "@/lib/supabase-client";

export const CLOSET_IMAGE_BUCKET = "closet-images";

// Closet cards render at ~110-200px; full-resolution camera photos (and
// especially the multi-MB PNG cutouts from subject lift) are wildly oversized
// for that and dominate upload time.
const MAX_UPLOAD_DIMENSION = 1600;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

function isPngUri(uri: string): boolean {
  return (
    uri.startsWith("data:image/png") ||
    /\.png$/i.test(uri.split(/[?#]/)[0])
  );
}

// Best-effort: returns the original uri untouched if it's already small
// enough or if resizing fails for any reason.
async function downscaleForUpload(localUri: string): Promise<string> {
  try {
    const { width, height } = await getImageSize(localUri);
    if (Math.max(width, height) <= MAX_UPLOAD_DIMENSION) return localUri;
    const png = isPngUri(localUri);
    const result = await ImageManipulator.manipulateAsync(
      localUri,
      [
        {
          resize:
            width >= height
              ? { width: MAX_UPLOAD_DIMENSION }
              : { height: MAX_UPLOAD_DIMENSION },
        },
      ],
      {
        compress: png ? 1 : 0.85,
        // Keep PNG for subject-lift cutouts so the transparent background survives.
        format: png
          ? ImageManipulator.SaveFormat.PNG
          : ImageManipulator.SaveFormat.JPEG,
      },
    );
    return result.uri;
  } catch {
    return localUri;
  }
}

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
  // Already a hosted URL (e.g. uploaded at paste time for phone-side
  // background removal) — nothing to upload.
  if (/^https?:\/\//i.test(localUri)) return localUri;

  const supabase = getSupabase();
  const uploadUri = await downscaleForUpload(localUri);

  // On native, Hermes doesn't support creating Blobs from ArrayBuffer/ArrayBufferView
  // and fetch() of file:// URIs returns empty bodies on physical devices.
  // Supabase storage accepts ArrayBuffer directly, so we use that on native.
  let uploadBody: ArrayBuffer | Blob;
  let contentType: string;

  if (Platform.OS !== "web") {
    let base64: string;
    if (uploadUri.startsWith("data:")) {
      const [header, b64] = uploadUri.split(",");
      contentType = header.split(":")[1]?.split(";")[0] ?? "image/jpeg";
      base64 = b64;
    } else {
      contentType = isPngUri(uploadUri) ? "image/png" : "image/jpeg";
      base64 = await FileSystem.readAsStringAsync(uploadUri, {
        encoding: "base64",
      });
    }
    uploadBody = base64ToArrayBuffer(base64);
  } else {
    const response = await fetch(uploadUri);
    uploadBody = await response.blob();
    contentType = (uploadBody as Blob).type || "image/jpeg";
  }

  const ext = contentType.split("/")[1]?.split("+")[0] || "jpg";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const path = `${userId ?? "anon"}/${uniqueId}.${ext}`;

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