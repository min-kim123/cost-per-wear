import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { SpeckleFade } from "@/components/speckle-fade";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TAB_META } from "@/constants/tabs";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useDevTabVisibility } from "@/lib/dev-tab-visibility";
import { useDevToggle } from "@/lib/dev-toggles";
import { getSupabase } from "@/lib/supabase-client";

// Every tab except Data can be hidden — Settings is opened from the profile
// menu on the Data tab, so hiding Data would lock you out of this screen.
const TOGGLEABLE_TABS = TAB_META.filter((t) => t.key !== "data");


export default function SettingsScreen() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { isHidden, toggle } = useDevTabVisibility();
  const categoriesToggle = useDevToggle("closet:categories");
  const metricToggle = useDevToggle("closet:metric");

  const closetToggles = [
    { label: "Categories filter", icon: "filter-outline", ...categoriesToggle },
    { label: "Metric selection", icon: "stats-chart-outline", ...metricToggle },
  ] as const;

  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#ffffff" }, "background");
  const iconColor = useThemeColor({}, "text");
  const destructiveColor = "#C00";

  const doSignOut = async () => {
    setSigningOut(true);
    setConfirming(false);
    try {
      await getSupabase().auth.signOut();
      router.replace("/auth");
    } catch (e) {
      Alert.alert(
        "Error",
        e instanceof Error ? e.message : "Could not sign out.",
      );
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      {confirming ? (
        <View style={[styles.section, { borderColor, backgroundColor: inputBackground }]}>
          <View style={styles.confirmRow}>
            <ThemedText style={[styles.confirmText, { color: destructiveColor }]}>
              Sign out of your account?
            </ThemedText>
            <View style={styles.confirmButtons}>
              <Pressable
                onPress={() => setConfirming(false)}
                disabled={signingOut}
                style={({ pressed }) => [styles.confirmBtn, { borderColor }, pressed && styles.btnPressed]}
              >
                <ThemedText style={styles.confirmBtnLabel}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={doSignOut}
                disabled={signingOut}
                style={({ pressed }) => [styles.confirmBtn, styles.confirmBtnDestructive, pressed && styles.btnPressed]}
              >
                {signingOut ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={[styles.confirmBtnLabel, { color: "#fff" }]}>
                    Sign out
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setConfirming(true)}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.section,
            styles.row,
            { borderColor, backgroundColor: inputBackground },
            pressed && styles.btnPressed,
            signingOut && styles.rowDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={18} color={destructiveColor} />
          <ThemedText style={[styles.rowLabel, { color: destructiveColor }]}>
            Sign out
          </ThemedText>
        </Pressable>
      )}

      {__DEV__ && (
        <View style={styles.devSection}>
          <ThemedText style={styles.devHeading}>
            Dev: navbar tabs
          </ThemedText>
          <View style={styles.sectionGroup}>
            {TOGGLEABLE_TABS.map((tab) => (
              <View
                key={tab.key}
                style={[styles.section, styles.row, { borderColor, backgroundColor: inputBackground }]}
              >
                <Ionicons name={tab.icon.default as never} size={18} color={iconColor} />
                <ThemedText style={styles.rowLabel}>{tab.title}</ThemedText>
                <View style={styles.rowSpacer} />
                <Switch
                  value={!isHidden(tab.key)}
                  onValueChange={() => toggle(tab.key)}
                />
              </View>
            ))}
          </View>
        </View>
      )}

      {__DEV__ && (
        <View style={styles.devSection}>
          <ThemedText style={styles.devHeading}>
            Dev: closet UI
          </ThemedText>
          <View style={styles.sectionGroup}>
            {closetToggles.map((t) => (
              <View
                key={t.label}
                style={[styles.section, styles.row, { borderColor, backgroundColor: inputBackground }]}
              >
                <Ionicons name={t.icon as never} size={18} color={iconColor} />
                <ThemedText style={styles.rowLabel}>{t.label}</ThemedText>
                <View style={styles.rowSpacer} />
                <Switch value={!t.hidden} onValueChange={t.toggle} />
              </View>
            ))}
          </View>
        </View>
      )}

      <SpeckleFade height={72} edge="bottom" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  section: {
    height: 40,
    borderWidth: 1,
    borderRadius: 10,
  },
  sectionGroup: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  rowSpacer: {
    flex: 1,
  },
  devSection: {
    marginTop: 28,
  },
  devHeading: {
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.6,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  confirmRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  confirmText: {
    flex: 1,
    fontSize: 13,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 8,
  },
  confirmBtn: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnDestructive: {
    backgroundColor: "#C00",
    borderColor: "#C00",
  },
  confirmBtnLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  btnPressed: {
    opacity: 0.65,
  },
});
