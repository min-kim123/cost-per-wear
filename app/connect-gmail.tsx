import { getSupabase } from "@/lib/supabase-client";
import * as AuthSession from "expo-auth-session";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ConnectGmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    setLoading(true);
    try {
      const redirectUri = AuthSession.makeRedirectUri();
      const supabase = getSupabase();

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
          scopes:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });

      if (oauthError || !data.url) {
        setError(oauthError?.message ?? "OAuth failed");
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUri,
      );

      if (result.type === "success") {
        const parsed = new URL(result.url);
        const code = parsed.searchParams.get("code");
        if (code) {
          const { data: sessionData, error: sessionError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (sessionError) {
            setError(sessionError.message);
            return;
          }
          const refreshToken = sessionData.session?.provider_refresh_token;
          const accessToken = sessionData.session?.provider_token;

          if (refreshToken) {
            const { error: fnError } = await supabase.functions.invoke(
              "store-gmail-token",
              {
                body: {
                  refresh_token: refreshToken,
                  access_token: accessToken,
                },
              },
            );
            if (fnError) {
              console.error("Gmail token storage failed:", fnError);
              setError(
                "Gmail connected but token storage failed. Please try again.",
              );
              return;
            }
            // --- CRITICAL FIX START ---
            // Extract the user session details to authenticate the background scan call
            const {
              data: { session },
            } = await supabase.auth.getSession();

            if (session?.access_token) {
              try {
                const { error } = await supabase.functions.invoke("initial-gmail-scan", {
                  headers: {
                    Authorization: `Bearer ${session.access_token}`,
                  },
                });

                if (error) {
                  console.error("Edge function returned an error status:", error);
                }
              } catch (e) {
                console.error("Network request failed to reach server:", e);
              }
            }
          }
          // router.replace("/(tabs)");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.inner}>
        <Text style={styles.title}>Connect your Gmail</Text>

        <Text style={styles.subtitle}>
          To automatically track your clothing purchases, we need read-only
          access to your Gmail.
        </Text>

        <View style={styles.bullets}>
          <Text style={styles.bullet}>
            {"• "}We only scan for shopping receipts — nothing else is read.
          </Text>
          <Text style={styles.bullet}>
            {"• "}Access is read-only. We can never send, delete, or modify
            emails.
          </Text>
          <Text style={styles.bullet}>
            {"• "}New purchases are imported automatically in the background.
          </Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Gmail</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.replace("/(tabs)")}>
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
    marginBottom: 20,
    lineHeight: 22,
  },
  bullets: {
    gap: 10,
    marginBottom: 32,
  },
  bullet: {
    fontSize: 14,
    color: "#444",
    lineHeight: 20,
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
  errorText: {
    color: "#D00",
    marginBottom: 12,
    fontSize: 13,
  },
});
