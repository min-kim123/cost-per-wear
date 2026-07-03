import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { migrateLocalOutfitsToSupabase } from "@/lib/outfit-storage";
import { getSupabase } from "@/supabase-client";

export const unstable_settings = {
  anchor: "(tabs)",
};

const DEV_SKIP_AUTH =
  process.env.EXPO_PUBLIC_DEV_SKIP_AUTH === "true";
const DEV_EMAIL = process.env.EXPO_PUBLIC_DEV_EMAIL ?? "";
const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? "";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (DEV_SKIP_AUTH) {
      const supabase = getSupabase();
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (!session && DEV_EMAIL && DEV_PASSWORD) {
          await supabase.auth.signInWithPassword({
            email: DEV_EMAIL,
            password: DEV_PASSWORD,
          });
        }
        const inAuthScreen = segmentsRef.current[0] === "auth";
        if (inAuthScreen) router.replace("/(tabs)");
        setChecked(true);
      });
      return;
    }

    const supabase = getSupabase();

    supabase.auth.getSession().then(({ data: { session } }) => {
      const inAuthScreen = segmentsRef.current[0] === "auth";
      if (!session && !inAuthScreen) {
        router.replace("/auth");
      } else if (session && inAuthScreen) {
        router.replace("/(tabs)");
      }
      setChecked(true);
      // Best-effort one-time migration from AsyncStorage to Supabase
      if (session) migrateLocalOutfitsToSupabase().catch(() => {});
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const inAuthScreen = segmentsRef.current[0] === "auth";
        if (!session && !inAuthScreen) {
          router.replace("/auth");
        } else if (session && inAuthScreen) {
          router.replace("/(tabs)");
          migrateLocalOutfitsToSupabase().catch(() => {});
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
    <GestureHandlerRootView style={{ flex: 1 }}>
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
              <Stack.Screen
                name="web-capture"
                options={{ presentation: "fullScreenModal", headerShown: false }}
              />
              <Stack.Screen
                name="crop-image"
                options={{ presentation: "fullScreenModal", headerShown: false }}
              />
              <Stack.Screen name="day-outfits" options={{ headerShown: false }} />
            </Stack>
          </AuthGuard>
        </SafeAreaView>
        <StatusBar style="dark" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
