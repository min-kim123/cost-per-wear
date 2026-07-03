import { Platform } from "react-native";

import { isSubjectLiftAvailable, liftSubject as liftSubjectNative } from "@/modules/subject-lift";

// True only on iOS with a build that includes the native SubjectLift module
// (a custom dev client or standalone build — this is always false in Expo Go).
export function subjectLiftAvailable(): boolean {
  return Platform.OS === "ios" && isSubjectLiftAvailable();
}

/**
 * Cuts the main subject out of a local photo, on-device, using the same
 * Vision framework model behind Photos' "lift subject" long-press gesture.
 * Returns a local file URI to a transparent-background PNG. Throws on any
 * failure — callers should fall back to the original photo.
 */
export async function liftSubject(localUri: string): Promise<string> {
  if (!subjectLiftAvailable()) {
    throw new Error("Subject lifting is not available on this device.");
  }
  return liftSubjectNative(localUri);
}
