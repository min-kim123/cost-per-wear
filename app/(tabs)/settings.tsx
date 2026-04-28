import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { getSupabase } from "@/supabase-client";

export default function SettingsScreen() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
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
      <ThemedText type="title" style={styles.heading}>
        Settings
      </ThemedText>

      <View style={[styles.section, { borderColor }]}>
        {confirming ? (
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
        ) : (
          <Pressable
            onPress={() => setConfirming(true)}
            disabled={signingOut}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.btnPressed,
              signingOut && styles.rowDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={22} color={destructiveColor} />
            <ThemedText style={[styles.rowLabel, { color: destructiveColor }]}>
              Sign out
            </ThemedText>
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  heading: {
    marginBottom: 28,
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  confirmRow: {
    padding: 16,
    gap: 12,
  },
  confirmText: {
    fontSize: 15,
    textAlign: "center",
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 10,
  },
  confirmBtn: {
    flex: 1,
    height: 44,
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
    fontSize: 15,
    fontWeight: "600",
  },
  btnPressed: {
    opacity: 0.65,
  },
});
