import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSupabase } from "@/supabase-client";

export const unstable_settings = {
  anchor: "(tabs)",
};

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data: { session } }) => {
      const inAuthScreen = segmentsRef.current[0] === "auth";
      if (!session && !inAuthScreen) {
        router.replace("/auth");
      } else if (session && inAuthScreen) {
        router.replace("/(tabs)");
      }
      setChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const inAuthScreen = segmentsRef.current[0] === "auth";
        if (!session && !inAuthScreen) {
          router.replace("/auth");
        } else if (session && inAuthScreen) {
          router.replace("/(tabs)");
        }
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  if (!checked) return null;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <AuthGuard>
          <Stack>
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="modal"
              options={{ presentation: "modal", title: "Modal" }}
            />
            <Stack.Screen name="closet" options={{ title: "closet" }} />
            <Stack.Screen
              name="calendar"
              options={{ title: "Calendar", animation: "slide_from_left" }}
            />
            <Stack.Screen
              name="select-outfit-items"
              options={{ title: "Today's outfit", presentation: "modal" }}
            />
            <Stack.Screen
              name="add-closet-item"
              options={{ title: "Add item", presentation: "modal" }}
            />
            <Stack.Screen
              name="edit-closet-item"
              options={{ title: "Edit item", presentation: "modal" }}
            />
            <Stack.Screen name="day-outfits" options={{ headerShown: false }} />
          </Stack>
        </AuthGuard>
      </SafeAreaView>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
