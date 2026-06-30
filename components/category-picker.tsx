import { Pressable, ScrollView, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";

export const CATEGORIES = [
  "top",
  "pants",
  "shoes",
  "jewelry",
  "hat",
  "accessory",
] as const;

export type Category = (typeof CATEGORIES)[number];

type Props = {
  value: Category | null;
  onChange: (cat: Category | null) => void;
  nullable?: boolean;
  disabled?: boolean;
};

export function CategoryPicker({
  value,
  onChange,
  nullable = false,
  disabled = false,
}: Props) {
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const textColor = useThemeColor({}, "text");

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {CATEGORIES.map((cat) => {
        const selected = value === cat;
        return (
          <Pressable
            key={cat}
            onPress={() => {
              if (disabled) return;
              onChange(selected && nullable ? null : cat);
            }}
            style={[
              styles.chip,
              { borderColor },
              selected && styles.chipSelected,
              disabled && styles.chipDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={cat}
            accessibilityState={{ selected }}
          >
            <ThemedText
              style={[
                styles.chipText,
                { color: selected ? "#fff" : textColor },
              ]}
            >
              {cat}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// A non-scrollable wrapping version for filter bars
export function CategoryFilterBar({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (cat: Category | null) => void;
}) {
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const textColor = useThemeColor({}, "text");

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      <Pressable
        onPress={() => onChange(null)}
        style={[
          styles.chip,
          { borderColor },
          value === null && styles.chipSelected,
        ]}
        accessibilityRole="button"
        accessibilityLabel="All"
        accessibilityState={{ selected: value === null }}
      >
        <ThemedText
          style={[
            styles.chipText,
            { color: value === null ? "#fff" : textColor },
          ]}
        >
          all
        </ThemedText>
      </Pressable>
      {CATEGORIES.map((cat) => {
        const selected = value === cat;
        return (
          <Pressable
            key={cat}
            onPress={() => onChange(selected ? null : cat)}
            style={[
              styles.chip,
              { borderColor },
              selected && styles.chipSelected,
            ]}
            accessibilityRole="button"
            accessibilityLabel={cat}
            accessibilityState={{ selected }}
          >
            <ThemedText
              style={[
                styles.chipText,
                { color: selected ? "#fff" : textColor },
              ]}
            >
              {cat}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipSelected: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
