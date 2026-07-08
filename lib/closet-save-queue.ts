// Background save queue for new closet items. The add-item screen enqueues
// its items and dismisses immediately; uploads run here one at a time while
// the user keeps using the app. Subscribers (the global save indicator, the
// closet screen) get notified as each item lands.
import { DAILY_STACK_CATEGORY_NAME } from "@/lib/categories";
import { uploadClosetItemImage } from "@/lib/closet-upload";
import { getSupabase } from "@/lib/supabase-client";

export type PendingClosetSave = {
  name: string;
  brand: string;
  cost: number;
  wears: number;
  localUri: string | null;
  category: string | null;
  // True when this platform couldn't remove the background itself (web,
  // Android) — an iOS device picks the item up and runs the cutout there.
  needsBgRemoval?: boolean;
};

export type ClosetSaveState = {
  active: boolean;
  done: number;
  total: number;
  errors: number;
};

let queue: PendingClosetSave[] = [];
let running = false;
let state: ClosetSaveState = { active: false, done: 0, total: 0, errors: 0 };
const listeners = new Set<(s: ClosetSaveState) => void>();

function emit() {
  const snapshot = { ...state };
  listeners.forEach((cb) => cb(snapshot));
}

export function subscribeClosetSaves(
  cb: (s: ClosetSaveState) => void,
): () => void {
  listeners.add(cb);
  cb({ ...state });
  return () => {
    listeners.delete(cb);
  };
}

export function enqueueClosetSaves(items: PendingClosetSave[]) {
  if (items.length === 0) return;
  queue.push(...items);
  state = state.active
    ? { ...state, total: state.total + items.length }
    : { active: true, done: 0, total: items.length, errors: 0 };
  emit();
  if (!running) void processQueue();
}

async function processQueue() {
  running = true;
  const supabase = getSupabase();
  // Resolved once per run — getSession() is local (no network round trip),
  // and RLS rejects the writes anyway if the session ends mid-batch.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  let savedNeedingBgRemoval = false;
  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      const image = item.localUri
        ? await uploadClosetItemImage(item.localUri, user?.id)
        : null;
      const needsBgRemoval = !!image && !!item.needsBgRemoval;
      const { error } = await supabase.from("closet").insert({
        name: item.name,
        brand: item.brand,
        cost: item.cost,
        wears: item.wears,
        image,
        category: item.category,
        needs_bg_removal: needsBgRemoval,
        daily_stack_since:
          item.category === DAILY_STACK_CATEGORY_NAME
            ? new Date().toISOString()
            : null,
        user_id: user?.id,
      });
      if (error) throw new Error(error.message);
      if (needsBgRemoval) savedNeedingBgRemoval = true;
      state = { ...state, done: state.done + 1 };
    } catch {
      state = { ...state, done: state.done + 1, errors: state.errors + 1 };
    }
    emit();
  }
  // Wake the user's iPhone with a silent push so it can run the cutouts now
  // instead of waiting for the app to next open.
  if (savedNeedingBgRemoval) {
    supabase.functions.invoke("notify-bg-removal").catch(() => {});
  }
  running = false;
  state = { ...state, active: false };
  emit();
}
