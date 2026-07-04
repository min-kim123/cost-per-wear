import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneMap, TabView } from "react-native-tab-view";

import { TAB_META, type RouteKey } from "@/constants/tabs";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDevTabVisibility } from "@/lib/dev-tab-visibility";
import CalendarScreen from "./calendar";
import ClosetScreen from "./closet";
import DataScreen from "./data";
import HomeScreen from "./index";
import SettingsScreen from "./settings";
import ShoppingScreen from "./shopping";

const COMPONENTS: Record<RouteKey, React.ComponentType> = {
  calendar: CalendarScreen,
  index: HomeScreen,
  closet: ClosetScreen,
  shopping: ShoppingScreen,
  data: DataScreen,
  settings: SettingsScreen,
};

const TAB_CONFIG = TAB_META.map((meta) => ({
  ...meta,
  component: COMPONENTS[meta.key],
}));

const ICONS: Record<RouteKey, { default: string; active: string }> =
  Object.fromEntries(TAB_CONFIG.map(({ key, icon }) => [key, icon])) as Record<
    RouteKey,
    { default: string; active: string }
  >;

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const tint = Colors[colorScheme ?? "light"].tint;
  const iconDefault = Colors[colorScheme ?? "light"].tabIconDefault;
  const tabBarBg = colorScheme === "dark" ? "#1c1c1e" : "#fff";
  const dividerColor =
    colorScheme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";

  const { isHidden } = useDevTabVisibility();

  // Dev-only tab visibility toggles (Settings screen) filter this list;
  // in production builds every tab in TAB_CONFIG is always shown.
  const visibleConfig = useMemo(
    () => TAB_CONFIG.filter((t) => !isHidden(t.key)),
    [isHidden],
  );

  const routes = useMemo(
    () => visibleConfig.map(({ key, title }) => ({ key, title })),
    [visibleConfig],
  );

  const renderScene = useMemo(
    () =>
      SceneMap(
        Object.fromEntries(
          visibleConfig.map(({ key, component }) => [key, component]),
        ) as Record<RouteKey, React.ComponentType>,
      ),
    [visibleConfig],
  );

  const [selectedKey, setSelectedKey] = useState<RouteKey>("index"); // default to Home

  const index = useMemo(() => {
    const i = visibleConfig.findIndex((r) => r.key === selectedKey);
    return i === -1 ? 0 : i;
  }, [visibleConfig, selectedKey]);

  const handleIndexChange = useCallback(
    (i: number) => {
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const nextKey = visibleConfig[i]?.key;
      if (nextKey) setSelectedKey(nextKey);
    },
    [visibleConfig],
  );

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
              style={({ pressed }) => [
                styles.tabItem,
                pressed && { opacity: 0.7 },
              ]}
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
            </Pressable>
          );
        })}
      </View>
    );
  }, [
    routes,
    index,
    tint,
    iconDefault,
    insets.bottom,
    tabBarBg,
    dividerColor,
    handleIndexChange,
  ]);

  return (
    <TabView
      navigationState={{ index, routes }}
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
    paddingVertical: 10,
  },
});
