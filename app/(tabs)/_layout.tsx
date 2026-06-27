import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneMap, TabView } from "react-native-tab-view";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import CalendarScreen from "./calendar";
import ClosetScreen from "./closet";
import HomeScreen from "./index";
import SettingsScreen from "./settings";

const routes = [
  { key: "calendar", title: "Calendar" },
  { key: "index", title: "Home" },
  { key: "closet", title: "Closet" },
  { key: "settings", title: "Settings" },
] as const;

type RouteKey = (typeof routes)[number]["key"];

const ICONS: Record<RouteKey, { default: string; active: string }> = {
  calendar: { default: "calendar-outline", active: "calendar" },
  index: { default: "camera-outline", active: "camera" },
  closet: { default: "bag-outline", active: "bag" },
  settings: { default: "settings-outline", active: "settings" },
};

const renderScene = SceneMap({
  calendar: CalendarScreen,
  index: HomeScreen,
  closet: ClosetScreen,
  settings: SettingsScreen,
});

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const tint = Colors[colorScheme ?? "light"].tint;
  const iconDefault = Colors[colorScheme ?? "light"].tabIconDefault;
  const tabBarBg = colorScheme === "dark" ? "#1c1c1e" : "#fff";
  const dividerColor = colorScheme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";

  const [index, setIndex] = useState(1); // default to Home

  const handleIndexChange = useCallback((i: number) => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setIndex(i);
  }, []);

  const renderTabBar = useCallback(() => {
    return (
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: tabBarBg,
            borderTopColor: dividerColor,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        {routes.map((route, i) => {
          const focused = i === index;
          const color = focused ? tint : iconDefault;
          const icons = ICONS[route.key];
          return (
            <Pressable
              key={route.key}
              style={({ pressed }) => [styles.tabItem, pressed && { opacity: 0.7 }]}
              onPress={() => handleIndexChange(i)}
              accessibilityRole="tab"
              accessibilityLabel={route.title}
              accessibilityState={{ selected: focused }}
            >
              <Ionicons
                name={(focused ? icons.active : icons.default) as never}
                size={26}
                color={color}
              />
              <ThemedText style={[styles.tabLabel, { color }]}>
                {route.title}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    );
  }, [index, tint, iconDefault, insets.bottom, tabBarBg, dividerColor, handleIndexChange]);

  return (
    <TabView
      navigationState={{ index, routes: routes as unknown as { key: string; title: string }[] }}
      renderScene={renderScene}
      onIndexChange={handleIndexChange}
      renderTabBar={renderTabBar}
      tabBarPosition="bottom"
    />
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 6,
    paddingBottom: 0,
    gap: 0,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
});
