import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TabNavigationContext, useTabNavigation } from "@/lib/tab-navigation";
import { TabSwipeLockContext } from "@/lib/tab-swipe-lock";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  SceneMap,
  TabView,
  type SceneRendererProps,
} from "react-native-tab-view";

import { TAB_META, type RouteKey } from "@/constants/tabs";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDevTabVisibility } from "@/lib/dev-tab-visibility";
import CalendarScreen from "./calendar";
import ClosetScreen from "./closet";
import DataScreen from "./data";
import HomeScreen from "./index";
import OutfitBoardsScreen from "../outfit-boards";
import ShoppingScreen from "./shopping";

const COMPONENTS: Record<RouteKey, React.ComponentType> = {
  calendar: CalendarScreen,
  index: HomeScreen,
  closet: ClosetScreen,
  outfitBoards: OutfitBoardsScreen,
  shopping: ShoppingScreen,
  data: DataScreen,
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

// Reports the pager's live scroll progress so we can fire the tab-switch
// haptic the moment a swipe crosses the halfway point (where it commits),
// instead of after the page settles. The pager drives `position` with the
// native driver, and JS listeners never fire on the Animated.add() wrapper it
// exposes — only on the two underlying Animated.Values, so we reach into the
// node for them (same mechanism react-native-tab-view uses internally). If
// the internals ever change shape, we just don't attach and the haptic falls
// back to firing on index commit.
function PagerScrollSensor({
  position,
  onScroll,
}: {
  position: Animated.AnimatedInterpolation<number>;
  onScroll: (page: number | null, offset: number | null) => void;
}) {
  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }
    const node = position as unknown as { _a?: unknown; _b?: unknown };
    const page = node._a;
    const offset = node._b;
    if (
      !(page instanceof Animated.Value) ||
      !(offset instanceof Animated.Value)
    ) {
      return;
    }
    const pageSub = page.addListener(({ value }) => onScroll(value, null));
    const offsetSub = offset.addListener(({ value }) => onScroll(null, value));
    return () => {
      page.removeListener(pageSub);
      offset.removeListener(offsetSub);
    };
  }, [position, onScroll]);

  return null;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const tint = Colors[colorScheme ?? "light"].tint;
  const iconDefault = Colors[colorScheme ?? "light"].tabIconDefault;
  const tabBarBg = "#fff";
  const dividerColor = "rgba(0,0,0,0.12)";

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

  // Resolves to the root-level provider (app/_layout.tsx) — the selected
  // tab lives there so screens pushed on top of the pager (e.g. a calendar
  // day page) can switch tabs too, not just scenes embedded in it.
  const { selectedKey, goToTab: goToTabRoot } = useTabNavigation();
  const [swipeLocked, setSwipeLocked] = useState(false);

  const index = useMemo(() => {
    const i = visibleConfig.findIndex((r) => r.key === selectedKey);
    return i === -1 ? 0 : i;
  }, [visibleConfig, selectedKey]);

  const indexRef = useRef(index);
  indexRef.current = index;

  const tabHaptic = useCallback(() => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // One haptic per gesture: a swipe buzzes when it crosses the halfway point
  // (the commit threshold — a partial swipe that springs back stays silent).
  // Starts true so programmatic page animations (tab presses) stay silent too.
  const hapticFiredRef = useRef(true);
  // Latest pager page/offset, cleared each gesture so one gesture's leftover
  // value can't pair with the other's first event and fake a crossing.
  const swipePageRef = useRef<number | null>(null);
  const swipeOffsetRef = useRef<number | null>(null);

  const handleSwipeStart = useCallback(() => {
    hapticFiredRef.current = false;
    swipePageRef.current = null;
    swipeOffsetRef.current = null;
  }, []);

  const handlePagerScroll = useCallback(
    (page: number | null, offset: number | null) => {
      if (page != null) swipePageRef.current = page;
      if (offset != null) swipeOffsetRef.current = offset;
      if (hapticFiredRef.current) return;
      const p = swipePageRef.current;
      const o = swipeOffsetRef.current;
      if (p == null || o == null) return;
      if (Math.abs(p + o - indexRef.current) >= 0.5) {
        hapticFiredRef.current = true;
        tabHaptic();
      }
    },
    [tabHaptic],
  );

  const handleIndexChange = useCallback(
    (i: number) => {
      // Safety net: if a committed swipe somehow never crossed the threshold
      // in JS (e.g. missed scroll events), buzz on commit rather than never.
      if (i !== indexRef.current && !hapticFiredRef.current) {
        hapticFiredRef.current = true;
        tabHaptic();
      }
      const nextKey = visibleConfig[i]?.key;
      if (nextKey) goToTabRoot(nextKey);
    },
    [visibleConfig, tabHaptic, goToTabRoot],
  );

  const handleTabPress = useCallback(
    (i: number) => {
      // Mark fired so the scroll sensor stays quiet during the page animation.
      hapticFiredRef.current = true;
      tabHaptic();
      handleIndexChange(i);
    },
    [tabHaptic, handleIndexChange],
  );

  // Lets a screen embedded in the pager (e.g. Outfit Boards) jump to another
  // tab programmatically, silently (no haptic/animation) since it's not a
  // user tap on the tab bar. Re-provided (nested inside the root's own
  // provider) so embedded scenes get the haptic-silencing wrapper, while
  // screens pushed on top of the pager fall through to the plain root one.
  const goToTab = useCallback(
    (key: RouteKey) => {
      hapticFiredRef.current = true;
      goToTabRoot(key);
    },
    [goToTabRoot],
  );

  const tabNavigationValue = useMemo(
    () => ({ selectedKey, goToTab }),
    [selectedKey, goToTab],
  );

  const renderTabBar = useCallback(
    ({ position }: SceneRendererProps) => {
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
          <PagerScrollSensor position={position} onScroll={handlePagerScroll} />
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
                onPress={() => handleTabPress(i)}
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
    },
    [
      routes,
      index,
      tint,
      iconDefault,
      insets.bottom,
      tabBarBg,
      dividerColor,
      handleTabPress,
      handlePagerScroll,
    ],
  );

  return (
    <TabNavigationContext.Provider value={tabNavigationValue}>
      <TabSwipeLockContext.Provider value={{ setSwipeLocked }}>
        <TabView
          navigationState={{ index, routes }}
          renderScene={renderScene}
          onIndexChange={handleIndexChange}
          onSwipeStart={handleSwipeStart}
          renderTabBar={renderTabBar}
          tabBarPosition="bottom"
          swipeEnabled={!swipeLocked}
        />
      </TabSwipeLockContext.Provider>
    </TabNavigationContext.Provider>
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
