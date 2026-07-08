import type { RouteKey } from "@/constants/tabs";
import { useDevToggles } from "@/lib/dev-toggles";

// Settings is reached via the profile menu on the Data tab, so Data must
// always stay reachable — otherwise toggling tabs off could lock you out
// of the toggles themselves.
const LOCKED_VISIBLE: RouteKey = "data";

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
