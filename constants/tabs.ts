// Tab metadata shared between the tab bar and the dev-only visibility
// toggles on the Settings screen. Screen components are wired up
// separately in app/(tabs)/_layout.tsx to avoid a circular import with
// the Settings screen itself.
export const TAB_META = [
  {
    key: "calendar",
    title: "Calendar",
    icon: { default: "calendar-outline", active: "calendar" },
  },
  {
    key: "index",
    title: "Home",
    icon: { default: "camera-outline", active: "camera" },
  },
  {
    key: "closet",
    title: "Closet",
    icon: { default: "shirt-outline", active: "shirt" },
  },
  {
    key: "shopping",
    title: "Shopping",
    icon: { default: "bag-outline", active: "bag" },
  },
  {
    key: "data",
    title: "Data",
    icon: { default: "bar-chart-outline", active: "bar-chart" },
  },
  {
    key: "settings",
    title: "Settings",
    icon: { default: "settings-outline", active: "settings" },
  },
] as const;

export type RouteKey = (typeof TAB_META)[number]["key"];
