import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";
import { addBrand, getBrands, getClosetBrandCounts } from "@/lib/brands";
import { ThemedText } from "./themed-text";

type Props = {
  value: string;
  onChange: (value: string) => void;
  editable?: boolean;
  placeholder?: string;
  compact?: boolean;
  backgroundColor?: string;
};

export function BrandInput({
  value,
  onChange,
  editable = true,
  placeholder = "e.g. Uniqlo",
  compact = false,
  backgroundColor,
}: Props) {
  const [allBrands, setAllBrands] = useState<string[]>([]);
  const [brandCounts, setBrandCounts] = useState<Record<string, number>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const defaultInputBackground = useThemeColor({ light: "#EFEFF4" }, "background");
  const inputBackground = backgroundColor ?? defaultInputBackground;
  const dropdownBackground = useThemeColor({ light: "#fff" }, "background");
  const separatorColor = useThemeColor({ light: "#E5E5EA" }, "icon");

  useEffect(() => {
    getBrands().then(setAllBrands);
    getClosetBrandCounts().then(setBrandCounts);
  }, []);

  function computeSuggestions(text: string) {
    const q = text.trim().toLowerCase();
    const sorted = [...allBrands].sort(
      (a, b) => (brandCounts[b] ?? 0) - (brandCounts[a] ?? 0),
    );
    if (!q) return sorted;
    const matches = sorted.filter((b) => b.toLowerCase().includes(q));
    const exactMatch = allBrands.some((b) => b.toLowerCase() === q);
    if (!exactMatch) {
      return [...matches, `__add__:${text.trim()}`];
    }
    return matches;
  }

  function handleChangeText(text: string) {
    onChange(text);
    const next = computeSuggestions(text);
    setSuggestions(next);
    setOpen(next.length > 0);
  }

  async function handleSelect(item: string) {
    if (item.startsWith("__add__:")) {
      const newBrand = item.slice("__add__:".length);
      await addBrand(newBrand);
      const updated = await getBrands();
      setAllBrands(updated);
      onChange(newBrand);
    } else {
      onChange(item);
    }
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleFocus() {
    const next = computeSuggestions(value);
    setSuggestions(next);
    setOpen(true);
  }

  function handleBlur() {
    // Small delay so taps on dropdown items register before closing
    setTimeout(() => setOpen(false), 150);
  }

  return (
    <View style={styles.wrapper}>
      <TextInput
        ref={inputRef}
        style={[
          styles.input,
          compact && styles.inputCompact,
          { color: textColor, borderColor, backgroundColor: inputBackground },
        ]}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        value={value}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        editable={editable}
        autoCapitalize="words"
        autoCorrect={false}
      />

      {open && suggestions.length > 0 && (
        <View
          style={[
            styles.dropdown,
            compact && styles.dropdownCompact,
            { borderColor, backgroundColor: dropdownBackground },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="always" bounces={false}>
            {suggestions.map((item, index) => {
              const isAdd = item.startsWith("__add__:");
              const label = isAdd
                ? `Add "${item.slice("__add__:".length)}"`
                : item;
              return (
                <View key={item}>
                  {index > 0 && (
                    <View
                      style={[
                        styles.separator,
                        { backgroundColor: separatorColor },
                      ]}
                    />
                  )}
                  <Pressable
                    onPress={() => handleSelect(item)}
                    style={({ pressed }) => [
                      styles.suggestion,
                      pressed && styles.suggestionPressed,
                    ]}
                  >
                    <ThemedText
                      style={[styles.suggestionText, isAdd && styles.addText]}
                      numberOfLines={1}
                    >
                      {label}
                    </ThemedText>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    zIndex: 10,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  inputCompact: {
    height: 30,
    paddingVertical: 0,
    fontSize: 14,
  },
  dropdown: {
    position: "absolute",
    top: 46,
    left: 0,
    right: 0,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 8,
  },
  dropdownCompact: {
    top: 32,
  },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  suggestionPressed: {
    opacity: 0.55,
  },
  suggestionText: {
    fontSize: 15,
  },
  addText: {
    color: "#0a7ea4",
    fontWeight: "600",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
});
