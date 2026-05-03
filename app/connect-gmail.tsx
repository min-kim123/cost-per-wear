import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

WebBrowser.maybeCompleteAuthSession();

export default function ConnectGmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!,

    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
    ],

    extraParams: {
      access_type: "offline",
      prompt: "consent",
    },
  });

  useEffect(() => {
    if (response?.type === "success") {
      const auth = response.authentication;

      console.log("Gmail Access Token:", auth?.accessToken);
      console.log("Full Auth Object:", auth);

      // ⚠️ IMPORTANT (next step for you)
      // You should store:
      // - accessToken
      // - refreshToken (if present)

      router.replace("/(tabs)");
    }

    if (response?.type === "error") {
      setError("Failed to connect Gmail. Please try again.");
      setLoading(false);
    }
  }, [response]);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);

    try {
      await promptAsync();
    } catch (err) {
      setError("Something went wrong.");
      setLoading(false);
    }
  };

  const handleSkip = () => {
    router.replace("/(tabs)");
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.inner}>
        <Text style={styles.title}>Connect your Gmail</Text>

        <Text style={styles.subtitle}>
          Import your purchases and track cost per wear automatically.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={!request || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Gmail</Text>
          )}
        </Pressable>

        <Pressable onPress={handleSkip}>
          <Text style={styles.skip}>Skip for now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
  },
  inner: {
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
    marginBottom: 32,
    lineHeight: 22,
  },
  button: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  skip: {
    textAlign: "center",
    fontSize: 14,
    color: "#666",
  },
  error: {
    color: "#D00",
    marginBottom: 12,
  },
});
