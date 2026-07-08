import { createContext, useContext } from "react";

type TabSwipeLockContextValue = {
  setSwipeLocked: (locked: boolean) => void;
};

export const TabSwipeLockContext = createContext<TabSwipeLockContextValue>({
  setSwipeLocked: () => {},
});

export function useTabSwipeLock() {
  return useContext(TabSwipeLockContext);
}
