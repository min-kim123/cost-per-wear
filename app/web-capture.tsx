import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ViewShot from "react-native-view-shot";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { emitImageCaptured } from "@/lib/image-capture-bridge";

const DEFAULT_URL = "https://www.google.com";
const MIN_RECT_SIZE = 80;
// Matches the closet item card image (styles.image in app/(tabs)/closet.tsx: aspectRatio 3/4).
const CARD_ASPECT = 3 / 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function centeredCardRect(area: { width: number; height: number }) {
  if (area.width === 0 || area.height === 0) {
    return { x: 24, y: 24, width: 240, height: 240 / CARD_ASPECT };
  }
  let width = area.width * 0.7;
  let height = width / CARD_ASPECT;
  if (height > area.height * 0.9) {
    height = area.height * 0.9;
    width = height * CARD_ASPECT;
  }
  width = Math.max(MIN_RECT_SIZE, width);
  height = Math.max(MIN_RECT_SIZE, height);
  return {
    x: (area.width - width) / 2,
    y: (area.height - height) / 2,
    width,
    height,
  };
}

function resolveUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  const looksLikeDomain = /^[\w-]+(\.[\w-]+)+/.test(trimmed) && !trimmed.includes(" ");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (looksLikeDomain) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export default function WebCaptureScreen() {
  const router = useRouter();
  const { returnTo, id } = useLocalSearchParams<{ returnTo?: string; id?: string }>();
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const viewShotRef = useRef<ViewShot>(null);

  const [addressText, setAddressText] = useState(DEFAULT_URL);
  const [navUrl, setNavUrl] = useState(DEFAULT_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadingPage, setLoadingPage] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [showCaptureBox, setShowCaptureBox] = useState(false);
  const [captureAreaSize, setCaptureAreaSize] = useState({ width: 0, height: 0 });

  const [rect, setRect] = useState(() => centeredCardRect({ width: 0, height: 0 }));
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const areaSizeRef = useRef(captureAreaSize);
  areaSizeRef.current = captureAreaSize;

  const dragStart = useRef({ rectX: 0, rectY: 0 });
  const resizeStart = useRef({ width: 0, height: 0 });

  const textColor = useThemeColor({}, "text");
  const placeholderColor = useThemeColor({ light: "#8E8E93" }, "icon");
  const borderColor = useThemeColor({ light: "#C6C6C8" }, "icon");
  const inputBackground = useThemeColor({ light: "#F2F2F7" }, "background");

  const dragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = { rectX: rectRef.current.x, rectY: rectRef.current.y };
      },
      onPanResponderMove: (_evt, gesture) => {
        const area = areaSizeRef.current;
        const current = rectRef.current;
        const maxX = Math.max(0, area.width - current.width);
        const maxY = Math.max(0, area.height - current.height);
        setRect((r) => ({
          ...r,
          x: clamp(dragStart.current.rectX + gesture.dx, 0, maxX),
          y: clamp(dragStart.current.rectY + gesture.dy, 0, maxY),
        }));
      },
    }),
  ).current;

  const resizeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        resizeStart.current = { width: rectRef.current.width, height: rectRef.current.height };
      },
      onPanResponderMove: (_evt, gesture) => {
        const area = areaSizeRef.current;
        const current = rectRef.current;
        const maxWidth = Math.max(MIN_RECT_SIZE, area.width - current.x);
        const maxHeight = Math.max(MIN_RECT_SIZE, area.height - current.y);
        setRect((r) => ({
          ...r,
          width: clamp(resizeStart.current.width + gesture.dx, MIN_RECT_SIZE, maxWidth),
          height: clamp(resizeStart.current.height + gesture.dy, MIN_RECT_SIZE, maxHeight),
        }));
      },
    }),
  ).current;

  function goToAddress() {
    Keyboard.dismiss();
    setNavUrl(resolveUrl(addressText));
  }

  function handleNavChange(navState: WebViewNavigation) {
    setCanGoBack(navState.canGoBack);
    setLoadingPage(navState.loading);
    if (navState.url) setAddressText(navState.url);
  }

  async function handleCapture() {
    if (capturing) return;
    const capture = viewShotRef.current?.capture;
    if (!capture || captureAreaSize.width === 0) return;

    setCapturing(true);
    try {
      const rawUri = await capture();
      const meta = await ImageManipulator.manipulateAsync(rawUri, []);
      const scaleX = meta.width / captureAreaSize.width;
      const scaleY = meta.height / captureAreaSize.height;

      const cropped = await ImageManipulator.manipulateAsync(
        rawUri,
        [
          {
            crop: {
              originX: Math.round(rect.x * scaleX),
              originY: Math.round(rect.y * scaleY),
              width: Math.round(rect.width * scaleX),
              height: Math.round(rect.height * scaleY),
            },
          },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );

      if (returnTo === "edit" && id) {
        emitImageCaptured(cropped.uri);
        router.back();
      } else {
        router.replace({
          pathname: "/add-closet-item",
          params: { capturedUri: cropped.uri },
        });
      }
    } catch (e) {
      Alert.alert(
        "Capture failed",
        e instanceof Error ? e.message : "Could not capture that area. Try a different site or region.",
      );
    } finally {
      setCapturing(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.topBar, { paddingTop: insets.top + 8, borderColor }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={textColor} />
        </Pressable>
        <Pressable
          onPress={() => canGoBack && webviewRef.current?.goBack()}
          disabled={!canGoBack}
          hitSlop={8}
          style={[styles.iconBtn, !canGoBack && { opacity: 0.3 }]}
          accessibilityRole="button"
          accessibilityLabel="Go back in browser"
        >
          <Ionicons name="chevron-back" size={24} color={textColor} />
        </Pressable>
        <TextInput
          value={addressText}
          onChangeText={setAddressText}
          onSubmitEditing={goToAddress}
          placeholder="Search or enter a URL"
          placeholderTextColor={placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          style={[styles.addressInput, { color: textColor, backgroundColor: inputBackground, borderColor }]}
        />
        <Pressable
          onPress={goToAddress}
          hitSlop={8}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Go"
        >
          <Ionicons name="arrow-forward-circle" size={26} color={textColor} />
        </Pressable>
      </View>

      <View
        style={styles.captureArea}
        onLayout={(e) => setCaptureAreaSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        <ViewShot ref={viewShotRef} style={StyleSheet.absoluteFill} options={{ format: "jpg", quality: 0.92 }}>
          <WebView
            ref={webviewRef}
            source={{ uri: navUrl }}
            style={styles.webview}
            onNavigationStateChange={handleNavChange}
          />
        </ViewShot>

        {loadingPage && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator />
          </View>
        )}

        {captureAreaSize.width > 0 && showCaptureBox && (
          <>
            <View pointerEvents="none" style={[styles.mask, { top: 0, left: 0, right: 0, height: rect.y }]} />
            <View
              pointerEvents="none"
              style={[styles.mask, { top: rect.y + rect.height, left: 0, right: 0, bottom: 0 }]}
            />
            <View
              pointerEvents="none"
              style={[styles.mask, { top: rect.y, left: 0, width: rect.x, height: rect.height }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.mask,
                { top: rect.y, left: rect.x + rect.width, right: 0, height: rect.height },
              ]}
            />
            <View
              pointerEvents="box-none"
              style={[styles.captureRect, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}
            >
              <View style={styles.moveHandle} {...dragResponder.panHandlers}>
                <Ionicons name="move" size={14} color="#000" />
              </View>
              <View style={styles.resizeHandle} {...resizeResponder.panHandlers}>
                <Ionicons name="resize" size={14} color="#000" />
              </View>
            </View>
          </>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12, borderColor }]}>
        <ThemedText style={styles.hint}>
          {showCaptureBox
            ? "Browse normally, then use the corner handles to position the box over what you want to capture."
            : "Browse to what you want, then tap Show capture box."}
        </ThemedText>
        {showCaptureBox ? (
          <Pressable
            onPress={handleCapture}
            disabled={capturing}
            style={({ pressed }) => [
              styles.captureBtn,
              pressed && { opacity: 0.85 },
              capturing && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Capture selected area"
          >
            {capturing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.captureBtnText} lightColor="#fff" darkColor="#fff">
                Capture
              </ThemedText>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              setRect(centeredCardRect(captureAreaSize));
              setShowCaptureBox(true);
            }}
            style={({ pressed }) => [styles.captureBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Show capture box"
          >
            <ThemedText style={styles.captureBtnText} lightColor="#fff" darkColor="#fff">
              Show capture box
            </ThemedText>
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  addressInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  captureArea: {
    flex: 1,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  mask: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  captureRect: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#fff",
  },
  moveHandle: {
    position: "absolute",
    left: -14,
    top: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#00000022",
  },
  resizeHandle: {
    position: "absolute",
    right: -14,
    bottom: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#00000022",
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  hint: {
    fontSize: 12,
    opacity: 0.6,
    textAlign: "center",
  },
  captureBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  captureBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
