import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";

export type Category = string;

type Props = {
  value: Category | null;
  onChange: (cat: Category | null) => void;
  categories: Category[];
  nullable?: boolean;
  disabled?: boolean;
};

export function CategoryPicker({
  value,
  onChange,
  categories,
  nullable = false,
  disabled = false,
}: Props) {
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const textColor = useThemeColor({}, "text");

  return (
    <View style={styles.row}>
      {categories.map((cat) => {
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
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
