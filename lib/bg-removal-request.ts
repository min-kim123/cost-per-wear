// Web-side of on-paste background removal: uploads the photo, files a
// bg_removal_requests row, wakes the user's iPhone (silent push / realtime),
// and polls until the phone writes back the cutout URL. The caller keeps the
// original photo if no result arrives in time — the item is then flagged
// needs_bg_removal at save and the phone queue catches it later.
import { uploadClosetItemImage } from "@/lib/closet-upload";
import { getSupabase } from "@/lib/supabase-client";

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 60000;

export type PhoneBgRemoval = {
  // The uploaded original — reuse at save time to avoid a second upload.
  sourceUrl: string;
  // Resolves to the cutout URL, or null if the phone didn't answer in time.
  result: Promise<string | null>;
};

export async function requestPhoneBgRemoval(
  localUri: string,
): Promise<PhoneBgRemoval> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const sourceUrl = await uploadClosetItemImage(localUri, session.user.id);
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await supabase.from("bg_removal_requests").insert({
    id,
    user_id: session.user.id,
    source_url: sourceUrl,
  });
  if (error) throw new Error(error.message);

  // Silent push in case the phone app is backgrounded; realtime covers it
  // while open.
  supabase.functions.invoke("notify-bg-removal").catch(() => {});

  const result = (async () => {
    const deadline = Date.now() + TIMEOUT_MS;
    let resultUrl: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const { data, error: pollError } = await supabase
        .from("bg_removal_requests")
        .select("result_url")
        .eq("id", id)
        .maybeSingle();
      if (pollError) continue;
      if (!data) break; // row gone — nothing more to wait for
      if (data.result_url) {
        resultUrl = data.result_url;
        break;
      }
    }
    // Consume the request whether or not it was answered; an unanswered item
    // gets flagged at save time instead.
    try {
      await supabase.from("bg_removal_requests").delete().eq("id", id);
    } catch {
      // Stale rows are cleaned up by the phone's sweep.
    }
    return resultUrl;
  })();

  return { sourceUrl, result };
}
