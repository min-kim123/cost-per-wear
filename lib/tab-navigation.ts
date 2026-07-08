import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import { TAB_META, type RouteKey } from "@/constants/tabs";

// Lets any screen — a scene embedded in the tab pager, or a screen pushed on
// top of it (e.g. a calendar day page) — read/switch the selected tab. The
// tabs aren't router routes (see (tabs)/_layout.tsx), so this is the only
// way a pushed screen can land the app back on a specific tab: without it,
// navigating to "/(tabs)" just reveals whatever tab was already selected.
type TabNavigationContextValue = {
  selectedKey: RouteKey;
  goToTab: (key: RouteKey) => void;
};

export const TabNavigationContext = createContext<TabNavigationContextValue>({
  selectedKey: "index",
  goToTab: () => {},
});

export function useTabNavigation() {
  return useContext(TabNavigationContext);
}

/** Runs `effect` every time the given tab becomes the selected one. The tabs
 *  are pager scenes, not router routes, so expo-router's useFocusEffect only
 *  tracks the pager screen as a whole and never re-fires on tab switches —
 *  use this for per-tab focus work (e.g. refreshing a scene's data). */
export function useTabFocusEffect(key: RouteKey, effect: () => void) {
  const { selectedKey } = useTabNavigation();
  // Ref keeps a changing effect callback from re-triggering the hook; it
  // only fires when the selected tab actually changes to `key`.
  const effectRef = useRef(effect);
  effectRef.current = effect;
  useEffect(() => {
    if (selectedKey === key) effectRef.current();
  }, [selectedKey, key]);
}

// Persisted so a web refresh restores the tab you were on instead of
// resetting to Home.
const SELECTED_TAB_STORAGE_KEY = "cpw:selected-tab";

function loadPersistedTab(): RouteKey {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      const stored = window.sessionStorage.getItem(SELECTED_TAB_STORAGE_KEY);
      if (stored && TAB_META.some((t) => t.key === stored)) {
        return stored as RouteKey;
      }
    } catch {
      // storage unavailable (private mode etc.) — fall through
    }
  }
  return "index"; // default to Home
}

function persistSelectedTab(key: RouteKey) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(SELECTED_TAB_STORAGE_KEY, key);
    } catch {
      // best-effort
    }
  }
}

/** Owns the selected-tab state at the app root, so it's reachable from
 *  screens outside the tab pager, not just scenes embedded inside it. */
export function useTabNavigationState(): TabNavigationContextValue {
  const [selectedKey, setSelectedKey] = useState<RouteKey>(loadPersistedTab);

  const goToTab = useCallback((key: RouteKey) => {
    setSelectedKey(key);
    persistSelectedTab(key);
  }, []);

  return useMemo(() => ({ selectedKey, goToTab }), [selectedKey, goToTab]);
}
