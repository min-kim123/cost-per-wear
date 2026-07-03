import { requireNativeModule } from "expo-modules-core";

type SubjectLiftNativeModule = {
  isAvailable: boolean;
  liftSubject(sourceUri: string): Promise<string>;
};

let nativeModule: SubjectLiftNativeModule | null = null;
function getNativeModule(): SubjectLiftNativeModule | null {
  if (nativeModule) return nativeModule;
  try {
    nativeModule = requireNativeModule<SubjectLiftNativeModule>("SubjectLift");
    return nativeModule;
  } catch {
    // Not present on this platform/build (e.g. Android, or Expo Go without the module).
    return null;
  }
}

// True only on iOS 17+ running a build that actually includes this native
// module (a custom dev client or standalone build — never Expo Go).
export function isSubjectLiftAvailable(): boolean {
  return getNativeModule()?.isAvailable ?? false;
}

// Returns a local file:// URI to a PNG cutout of the main subject in
// `sourceUri`, background made transparent. Throws if unavailable or if no
// subject was found — callers should fall back to the original photo.
export async function liftSubject(sourceUri: string): Promise<string> {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Subject lifting is not available in this build.");
  }
  return module.liftSubject(sourceUri);
}
