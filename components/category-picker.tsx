import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";
import {
  CLOSET_CANDIDATES_CATEGORY_NAME,
  DAILY_STACK_CATEGORY_NAME,
} from "@/lib/categories";

export type Category = string;

// Special categories (different closet behavior) are rendered grey so they
// stand apart from the user's regular categories.
function isSpecialCategory(cat: Category): boolean {
  return (
    cat === DAILY_STACK_CATEGORY_NAME ||
    cat === CLOSET_CANDIDATES_CATEGORY_NAME
  );
}

type Props = {
  value: Category | null;
  onChange: (cat: Category | null) => void;
  categories: Category[];
  nullable?: boolean;
  disabled?: boolean;
  /** When provided, renders a "+" chip that lets the user create a new
   *  category inline. The newly created category is auto-selected. */
  onAddCategory?: (name: string) => Promise<Category>;
};

export function CategoryPicker({
  value,
  onChange,
  categories,
  nullable = false,
  disabled = false,
  onAddCategory,
}: Props) {
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const inputBackground = useThemeColor({ light: "#ffffff" }, "background");

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (adding) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [adding]);

  function cancelAdd() {
    setAdding(false);
    setNewName("");
  }

  async function submitAdd() {
    const trimmed = newName.trim();
    if (!trimmed || saving || !onAddCategory) return;
    setSaving(true);
    try {
      const created = await onAddCategory(trimmed);
      onChange(created);
      cancelAdd();
    } catch (e) {
      Alert.alert("Could not add category", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.row}>
      {categories.map((cat) => {
        const selected = value === cat;
        const special = isSpecialCategory(cat);
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
              special && styles.chipSpecial,
              selected && (special ? styles.chipSpecialSelected : styles.chipSelected),
              disabled && styles.chipDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={cat}
            accessibilityState={{ selected }}
          >
            <ThemedText
              style={[
                styles.chipText,
                { color: selected ? "#fff" : special ? "#6D6D72" : textColor },
              ]}
            >
              {cat}
            </ThemedText>
          </Pressable>
        );
      })}
      {onAddCategory && adding ? (
        <View style={[styles.addRow, { borderColor, backgroundColor: inputBackground }]}>
          <TextInput
            ref={inputRef}
            value={newName}
            onChangeText={setNewName}
            placeholder="New category"
            placeholderTextColor={placeholderColor}
            style={[styles.addInput, { color: textColor }]}
            editable={!saving}
            returnKeyType="done"
            onSubmitEditing={submitAdd}
          />
          <Pressable
            onPress={submitAdd}
            disabled={saving || !newName.trim()}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Confirm new category"
          >
            <Ionicons
              name="checkmark"
              size={18}
              color={saving || !newName.trim() ? placeholderColor : textColor}
            />
          </Pressable>
          <Pressable
            onPress={cancelAdd}
            disabled={saving}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Cancel adding category"
          >
            <Ionicons name="close" size={18} color={textColor} />
          </Pressable>
        </View>
      ) : onAddCategory ? (
        <Pressable
          onPress={() => !disabled && setAdding(true)}
          disabled={disabled}
          style={[styles.chip, styles.chipAdd, { borderColor }, disabled && styles.chipDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Add category"
        >
          <Ionicons name="add" size={18} color={textColor} />
        </Pressable>
      ) : null}
    </View>
  );
}

type MultiProps = {
  values: Set<Category>;
  onToggle: (cat: Category) => void;
  categories: Category[];
  disabled?: boolean;
};

/** Same chip row as CategoryPicker, but any number of categories can be active at once. */
export function MultiCategoryPicker({
  values,
  onToggle,
  categories,
  disabled = false,
}: MultiProps) {
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const textColor = useThemeColor({}, "text");

  return (
    <View style={styles.row}>
      {categories.map((cat) => {
        const selected = values.has(cat);
        return (
          <Pressable
            key={cat}
            onPress={() => {
              if (disabled) return;
              onToggle(cat);
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
  chipSpecial: {
    backgroundColor: "#E9E9EB",
    borderColor: "#C6C6C8",
  },
  chipSpecialSelected: {
    backgroundColor: "#8E8E93",
    borderColor: "#8E8E93",
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  chipAdd: {
    width: 32,
    paddingHorizontal: 0,
  },
  addRow: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  addInput: {
    fontSize: 13,
    minWidth: 90,
    padding: 0,
  },
});
