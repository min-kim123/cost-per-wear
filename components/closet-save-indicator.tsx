import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import {
  subscribeClosetSaves,
  type ClosetSaveState,
} from "@/lib/closet-save-queue";

// Small floating pill above the tab bar showing background closet-save
// progress. Mounted once in the root layout so it survives navigation.
export function ClosetSaveIndicator() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ClosetSaveState>({
    active: false,
    done: 0,
    total: 0,
    errors: 0,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(
    () =>
      subscribeClosetSaves((s) => {
        setState(s);
        if (s.active) setDismissed(false);
      }),
    [],
  );

  const bottom = insets.bottom + 58;

  if (state.active) {
    return (
      <View style={[styles.pill, { bottom }]} pointerEvents="none">
        <ActivityIndicator size="small" color="#fff" />
        <ThemedText style={styles.pillText} lightColor="#fff" darkColor="#fff">
          {state.total > 1
            ? `Saving ${Math.min(state.done + 1, state.total)} of ${state.total}…`
            : "Saving item…"}
        </ThemedText>
      </View>
    );
  }

  if (state.errors > 0 && !dismissed) {
    return (
      <Pressable
        onPress={() => setDismissed(true)}
        style={[styles.pill, styles.pillError, { bottom }]}
        accessibilityRole="button"
        accessibilityLabel="Dismiss save error"
      >
        <ThemedText style={styles.pillText} lightColor="#fff" darkColor="#fff">
          {state.errors === 1
            ? "1 item didn’t save — tap to dismiss"
            : `${state.errors} items didn’t save — tap to dismiss`}
        </ThemedText>
      </Pressable>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.85)",
    zIndex: 50,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  pillError: {
    backgroundColor: "#B91C1C",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
