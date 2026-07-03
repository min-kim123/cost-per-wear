import * as Clipboard from "expo-clipboard";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Alert, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

// The system paste control is a native UIKit view that Expo Go's precompiled
// binary doesn't include — it renders as a blank/inert placeholder there and
// needs a custom dev-client build to actually work.
const CAN_USE_SYSTEM_PASTE_BUTTON =
  Clipboard.isPasteButtonAvailable &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type Props = {
  onImage: (dataUrl: string) => void | Promise<void>;
  onBeforePaste?: () => void;
  // Width/height only — no backgroundColor/borderRadius/color (Apple restricts
  // customizing those on the system paste control; use the props below instead).
  size: { width: number; height: number };
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  foregroundColor?: string;
  cornerStyle?: "dynamic" | "fixed" | "capsule" | "large" | "medium" | "small";
  displayMode?: "iconAndLabel" | "iconOnly" | "labelOnly";
  accessibilityLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
};

async function readClipboardImage(): Promise<string | null> {
  const hasImage = await Clipboard.hasImageAsync();
  if (!hasImage) return null;
  const img = await Clipboard.getImageAsync({ format: "png" });
  return img?.data ?? null;
}

// Prefers the system paste button (UIPasteControl, iOS 16+), which is exempt
// from the "would like to paste from..." permission prompt since the OS treats
// tapping it as user consent. Falls back to a plain button elsewhere, which
// triggers that prompt on every tap — unavoidable outside the system control.
export function PasteImageButton({
  onImage,
  onBeforePaste,
  size,
  style,
  backgroundColor = "#fff",
  foregroundColor = "#000",
  cornerStyle = "capsule",
  displayMode = "iconAndLabel",
  accessibilityLabel = "Paste image from clipboard",
  disabled = false,
  children,
}: Props) {
  async function handleImage(data: string | null) {
    if (!data) {
      Alert.alert("Clipboard", "No image found on the clipboard.");
      return;
    }
    try {
      await onImage(data);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not paste image.");
    }
  }

  // The native control (below) has no documented `disabled` prop, so a disabled
  // state renders as a plain inert placeholder instead on every platform.
  if (disabled) {
    return (
      <View
        style={[
          {
            width: size.width,
            height: size.height,
            borderRadius: cornerStyle === "capsule" ? size.height / 2 : 10,
            backgroundColor,
            alignItems: "center",
            justifyContent: "center",
          },
          styles.disabled,
          style,
        ]}
      >
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  if (CAN_USE_SYSTEM_PASTE_BUTTON) {
    return (
      <Clipboard.ClipboardPasteButton
        onPress={(event) => {
          onBeforePaste?.();
          handleImage(event.type === "image" ? event.data : null);
        }}
        imageOptions={{ format: "png" }}
        acceptedContentTypes={["image"]}
        backgroundColor={backgroundColor}
        foregroundColor={foregroundColor}
        cornerStyle={cornerStyle}
        displayMode={displayMode}
        style={[{ width: size.width, height: size.height }, style]}
      />
    );
  }

  return (
    <Pressable
      onPress={() => {
        onBeforePaste?.();
        readClipboardImage()
          .then(handleImage)
          .catch((e) =>
            Alert.alert("Error", e instanceof Error ? e.message : "Could not paste image."),
          );
      }}
      style={[
        {
          width: size.width,
          height: size.height,
          borderRadius: cornerStyle === "capsule" ? size.height / 2 : 10,
          backgroundColor,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.content}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.45,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
