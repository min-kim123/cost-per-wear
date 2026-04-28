import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSupabase } from "@/supabase-client";

type Mode = "login" | "signup";

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSignedUp(false);
  }

  async function handleSubmit() {
    setError(null);
    setSignedUp(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabase();
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (authError) throw authError;
        router.replace("/(tabs)");
      } else {
        const { error: authError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (authError) throw authError;
        setSignedUp(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingBottom: insets.bottom + 24 }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.title}>cost per wear</Text>
          <Text style={styles.subtitle}>
            {isLogin ? "Welcome back." : "Create your account."}
          </Text>
        </View>

        {signedUp ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>
              Check your email for a confirmation link, then log in.
            </Text>
            <Pressable onPress={() => switchMode("login")}>
              <Text style={styles.toggleLink}>Go to log in</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              editable={!loading}
            />
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder={
                  isLogin ? "Password" : "Password (min. 6 characters)"
                }
                placeholderTextColor="#999"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setError(null);
                }}
                editable={!loading}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeButton}
                accessibilityLabel={
                  showPassword ? "Hide password" : "Show password"
                }
              >
                <Text style={styles.eyeText}>
                  {showPassword ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  {isLogin ? "Log in" : "Sign up"}
                </Text>
              )}
            </Pressable>
          </View>
        )}

        <View style={styles.toggle}>
          <Text style={styles.toggleText}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </Text>
          <Pressable onPress={() => switchMode(isLogin ? "signup" : "login")}>
            <Text style={styles.toggleLink}>
              {isLogin ? "Sign up" : "Log in"}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: "#111",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
  },
  form: {
    gap: 12,
    marginBottom: 28,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#F7F7F7",
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#111",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#F7F7F7",
    paddingRight: 14,
  },
  passwordInput: {
    flex: 1,
    height: 52,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#111",
  },
  eyeButton: {
    paddingVertical: 6,
    paddingLeft: 8,
  },
  eyeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
  },
  errorText: {
    fontSize: 13,
    color: "#D00",
    paddingHorizontal: 4,
  },
  button: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  successBox: {
    gap: 14,
    marginBottom: 28,
    padding: 20,
    borderRadius: 12,
    backgroundColor: "#F0FAF0",
    borderWidth: 1,
    borderColor: "#C3E6C3",
  },
  successText: {
    fontSize: 15,
    color: "#2A6B2A",
    lineHeight: 22,
  },
  toggle: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  toggleText: {
    fontSize: 14,
    color: "#666",
  },
  toggleLink: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111",
  },
});
