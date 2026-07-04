import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Dev-only: a generic "hide this UI element" switchboard, keyed by an
// arbitrary string id (e.g. "tab:closet", "closet:categories"). Never
// has an effect outside __DEV__ — see isHidden below. Backed by a single
// AsyncStorage entry so all dev toggles across the app share one store.
const STORAGE_KEY = "@cpw_dev_hidden_ids_v1";

type DevTogglesContextValue = {
  isHidden: (id: string) => boolean;
  toggle: (id: string) => void;
};

const DevTogglesContext = createContext<DevTogglesContextValue>({
  isHidden: () => false,
  toggle: () => {},
});

export function DevTogglesProvider({ children }: { children: ReactNode }) {
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  useEffect(() => {
    if (!__DEV__) return;
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHiddenIds(parsed);
      } catch {
        // ignore corrupt value
      }
    });
  }, []);

  const toggle = useCallback((id: string) => {
    if (!__DEV__) return;
    setHiddenIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((v) => v !== id)
        : [...prev, id];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const isHidden = useCallback(
    (id: string) => __DEV__ && hiddenIds.includes(id),
    [hiddenIds],
  );

  const value = useMemo(() => ({ isHidden, toggle }), [isHidden, toggle]);

  return (
    <DevTogglesContext.Provider value={value}>
      {children}
    </DevTogglesContext.Provider>
  );
}

/** Dev-only visibility toggle for a single UI element identified by `id`. */
export function useDevToggle(id: string) {
  const { isHidden, toggle } = useContext(DevTogglesContext);
  return {
    hidden: isHidden(id),
    toggle: useCallback(() => toggle(id), [toggle, id]),
  };
}

export function useDevToggles() {
  return useContext(DevTogglesContext);
}
