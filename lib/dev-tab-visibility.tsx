import type { RouteKey } from "@/constants/tabs";
import { useDevToggles } from "@/lib/dev-toggles";

// Settings must always stay reachable, so it can never be hidden.
const LOCKED_VISIBLE: RouteKey = "settings";

function idFor(key: RouteKey) {
  return `tab:${key}`;
}

/** Dev-only visibility toggles for navbar tabs. Wraps the generic dev-toggles store. */
export function useDevTabVisibility() {
  const { isHidden, toggle } = useDevToggles();

  return {
    isHidden: (key: RouteKey) => key !== LOCKED_VISIBLE && isHidden(idFor(key)),
    toggle: (key: RouteKey) => {
      if (key === LOCKED_VISIBLE) return;
      toggle(idFor(key));
    },
  };
}
