// Silent-push wiring for the background-removal queue. The notify-bg-removal
// edge function sends a data-only push when web/Android adds a flagged item;
// iOS wakes the app in the background (~30s) and this task runs the queue.
// Data-only pushes need no notification permission — just a device token —
// and are never shown to the user.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import {
  processPendingBgRemovals,
  watchBgRemovalQueue,
} from "@/lib/bg-removal-queue";
import { getSupabase } from "@/lib/supabase-client";

const BG_REMOVAL_TASK = "bg-removal-silent-push";

// Must be defined in module scope so the task exists when iOS launches the app
// directly into the background for a silent push. Guarded so builds without
// the expo-notifications native module (older dev clients) don't crash.
if (Platform.OS === "ios") {
  try {
    TaskManager.defineTask(BG_REMOVAL_TASK, async () => {
      await processPendingBgRemovals();
    });
  } catch {
    // Task definition is best-effort; the foreground sweep still runs.
  }
}

let initialized = false;

/**
 * Registers the background task, stores this device's Expo push token so the
 * edge function can reach it, and kicks off a sweep of anything already
 * pending. Call once a signed-in session exists. Best-effort: no-ops on web,
 * Android, and builds without the notifications native module.
 */
export async function initBgRemovalPush(): Promise<void> {
  if (Platform.OS !== "ios") return;
  // While the app is open, realtime picks up items flagged from other devices
  // instantly — covers the gap where no push arrives and no foreground
  // transition happens.
  watchBgRemovalQueue();
  try {
    if (!initialized) {
      await Notifications.registerTaskAsync(BG_REMOVAL_TASK);

      // Catches pushes that arrive while the app is open in the foreground.
      Notifications.addNotificationReceivedListener(() => {
        processPendingBgRemovals().catch(() => {});
      });

      const projectId = Constants.expoConfig?.extra?.eas?.projectId as
        | string
        | undefined;
      const { data: token } = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );

      const supabase = getSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        await supabase.from("push_tokens").upsert({
          token,
          user_id: session.user.id,
          platform: "ios",
          updated_at: new Date().toISOString(),
        });
        initialized = true;
      }
    }
  } catch {
    // Old build without the native module, simulator, or push service hiccup —
    // the queue still gets swept on foreground below.
  }
  processPendingBgRemovals().catch(() => {});
}
