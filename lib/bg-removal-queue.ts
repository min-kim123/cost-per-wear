// Phone side of cross-device background removal (web/Android can't run the
// on-device cutout themselves). Two kinds of work, both handled here:
//  - bg_removal_requests: filed the moment an image is pasted on web, before
//    the item is saved — web is actively polling, so these run first.
//  - closet rows flagged needs_bg_removal: items saved without a cutout.
// Runs when a silent push wakes the app (lib/bg-removal-push), on realtime
// events while open, and as a sweep whenever the app comes to the foreground.
import * as FileSystem from "expo-file-system/legacy";

import { uploadClosetItemImage } from "@/lib/closet-upload";
import { liftSubject, subjectLiftAvailable } from "@/lib/subject-lift";
import { getSupabase } from "@/lib/supabase-client";

// Silent-push background time is ~30s; keep batches small so a run can finish.
const MAX_ITEMS_PER_RUN = 5;

let running = false;
let rerunRequested = false;
let watching = false;

function extFromUrl(url: string): string {
  const match = url.split(/[?#]/)[0].match(/\.(\w{2,5})$/);
  return match ? match[1] : "jpg";
}

/**
 * Subscribes to realtime closet changes so flagged items added on another
 * device are processed the moment they land while the app is open — no push
 * or foreground transition needed. Safe to call repeatedly; subscribes once.
 */
export function watchBgRemovalQueue(): void {
  if (watching || !subjectLiftAvailable()) return;
  watching = true;
  getSupabase()
    .channel("bg-removal-queue")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "closet",
        filter: "needs_bg_removal=eq.true",
      },
      () => {
        processPendingBgRemovals().catch(() => {});
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bg_removal_requests" },
      () => {
        processPendingBgRemovals().catch(() => {});
      },
    )
    .subscribe();
}

/**
 * Answers pending paste-time requests: cutout of source_url written back to
 * result_url, which web is polling. A photo where Vision finds no subject is
 * answered with the original so the requester stops waiting. Also prunes
 * requests nobody consumed (requester deletes answered rows itself).
 */
async function processRemovalRequests(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
): Promise<number> {
  const { data: requests, error } = await supabase
    .from("bg_removal_requests")
    .select("id, source_url")
    .eq("user_id", userId)
    .is("result_url", null)
    .limit(MAX_ITEMS_PER_RUN);
  if (error || !requests) return 0;

  let processed = 0;
  for (const req of requests) {
    const localUri = `${FileSystem.cacheDirectory}bg-req-${req.id}.${extFromUrl(req.source_url)}`;
    try {
      await FileSystem.downloadAsync(req.source_url, localUri);
    } catch {
      continue; // transient (network) — retry next run
    }

    let cutoutUri: string | null = null;
    try {
      cutoutUri = await liftSubject(localUri);
    } catch {
      // Vision found no subject — answer with the original below so the
      // requester stops waiting.
    }

    let resultUrl = req.source_url;
    if (cutoutUri) {
      try {
        resultUrl = await uploadClosetItemImage(cutoutUri, userId);
      } catch {
        continue; // transient (upload) — leave pending and retry next run
      }
    }

    try {
      await supabase
        .from("bg_removal_requests")
        .update({ result_url: resultUrl })
        .eq("id", req.id);
      processed++;
    } catch {
      // Update failed — leave pending and retry next run.
    }
  }
  if (requests.length === MAX_ITEMS_PER_RUN) rerunRequested = true;

  // Prune abandoned rows (requester gone before consuming the answer).
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from("bg_removal_requests")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", cutoff);

  return processed;
}

/**
 * Best-effort: processes up to MAX_ITEMS_PER_RUN flagged items and returns how
 * many were handled. No-ops on devices without subject lift, when signed out,
 * or when a run is already in flight. A failed cutout keeps the original photo
 * and clears the flag so the item isn't retried forever.
 */
export async function processPendingBgRemovals(): Promise<number> {
  if (!subjectLiftAvailable()) return 0;
  if (running) {
    // A realtime event landed mid-run — run once more when this run finishes
    // so the new item isn't missed.
    rerunRequested = true;
    return 0;
  }
  running = true;
  try {
    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return 0;

    // Paste-time requests first — web is actively polling for the answer.
    let processed = await processRemovalRequests(supabase, session.user.id);

    const { data: rows, error } = await supabase
      .from("closet")
      .select("id, image")
      .eq("user_id", session.user.id)
      .eq("needs_bg_removal", true)
      .not("image", "is", null)
      .limit(MAX_ITEMS_PER_RUN);
    if (error || !rows || rows.length === 0) return processed;
    for (const row of rows) {
      const localUri = `${FileSystem.cacheDirectory}bg-queue-${row.id}.${extFromUrl(row.image)}`;
      try {
        await FileSystem.downloadAsync(row.image, localUri);
      } catch {
        continue; // transient (network) — leave flagged and retry next run
      }

      let cutoutUri: string;
      try {
        cutoutUri = await liftSubject(localUri);
      } catch {
        // Vision found no subject — keep the original photo and stop retrying.
        await supabase
          .from("closet")
          .update({ needs_bg_removal: false })
          .eq("id", row.id);
        continue;
      }

      try {
        const image = await uploadClosetItemImage(cutoutUri, session.user.id);
        await supabase
          .from("closet")
          .update({ image, needs_bg_removal: false })
          .eq("id", row.id);
        processed++;
      } catch {
        // Upload/update failed — leave flagged and retry next run.
      }
    }
    // A full batch means more may be waiting — keep draining.
    if (rows.length === MAX_ITEMS_PER_RUN) rerunRequested = true;
    return processed;
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      processPendingBgRemovals().catch(() => {});
    }
  }
}
