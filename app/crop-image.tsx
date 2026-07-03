import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { emitImageCaptured } from "@/lib/image-capture-bridge";

const MIN_RECT_SIZE = 60;
// Matches the closet item card image (styles.image in app/(tabs)/closet.tsx: aspectRatio 3/4).
const CARD_ASPECT = 3 / 4;

type Rect = { x: number; y: number; width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function centeredCropRect(box: Box): Rect {
  if (box.width === 0 || box.height === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let width = box.width;
  let height = width / CARD_ASPECT;
  if (height > box.height) {
    height = box.height;
    width = height * CARD_ASPECT;
  }
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

export default function CropImageScreen() {
  const router = useRouter();
  const { uri, returnTo, id } = useLocalSearchParams<{
    uri: string;
    returnTo?: string;
    id?: string;
  }>();
  const insets = useSafeAreaInsets();

  const [displayArea, setDisplayArea] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const rectRef = useRef(rect);
  rectRef.current = rect;
  const boxRef = useRef<Box>({ x: 0, y: 0, width: 0, height: 0 });

  const dragStart = useRef({ rectX: 0, rectY: 0 });
  const resizeStart = useRef({ width: 0, height: 0 });

  const box: Box = (() => {
    if (!naturalSize || displayArea.width === 0 || displayArea.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const containerAspect = displayArea.width / displayArea.height;
    const imageAspect = naturalSize.width / naturalSize.height;
    if (imageAspect > containerAspect) {
      const width = displayArea.width;
      const height = width / imageAspect;
      return { x: 0, y: (displayArea.height - height) / 2, width, height };
    }
    const height = displayArea.height;
    const width = height * imageAspect;
    return { x: (displayArea.width - width) / 2, y: 0, width, height };
  })();
  boxRef.current = box;

  useEffect(() => {
    if (!uri) return;
    RNImage.getSize(
      uri,
      (width, height) => setNaturalSize({ width, height }),
      () => setError(true),
    );
  }, [uri]);

  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    setRect((r) => (r.width === 0 ? centeredCropRect(box) : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.width, box.height]);

  const dragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = { rectX: rectRef.current.x, rectY: rectRef.current.y };
      },
      onPanResponderMove: (_evt, gesture) => {
        const b = boxRef.current;
        const current = rectRef.current;
        const minX = b.x;
        const minY = b.y;
        const maxX = b.x + b.width - current.width;
        const maxY = b.y + b.height - current.height;
        setRect((r) => ({
          ...r,
          x: clamp(dragStart.current.rectX + gesture.dx, minX, maxX),
          y: clamp(dragStart.current.rectY + gesture.dy, minY, maxY),
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
        const b = boxRef.current;
        const current = rectRef.current;
        const maxWidth = b.x + b.width - current.x;
        const maxHeight = b.y + b.height - current.y;
        let width = clamp(resizeStart.current.width + gesture.dx, MIN_RECT_SIZE, maxWidth);
        let height = width / CARD_ASPECT;
        if (height > maxHeight) {
          height = maxHeight;
          width = height * CARD_ASPECT;
        }
        if (width < MIN_RECT_SIZE) {
          width = MIN_RECT_SIZE;
          height = width / CARD_ASPECT;
        }
        setRect((r) => ({ ...r, width, height }));
      },
    }),
  ).current;

  async function handleUse() {
    if (saving || !naturalSize || box.width === 0) return;
    setSaving(true);
    try {
      const scaleX = naturalSize.width / box.width;
      const scaleY = naturalSize.height / box.height;

      // ImageManipulator can't render directly from a remote URL on native;
      // it needs a local file (web's implementation handles remote URLs fine).
      let sourceUri = uri;
      if (Platform.OS !== "web" && /^https?:\/\//i.test(uri)) {
        const ext = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
        const safeExt = ext && /^[a-z0-9]{2,4}$/.test(ext) ? ext : "jpg";
        const dest = `${FileSystem.cacheDirectory}crop-src-${Date.now()}.${safeExt}`;
        const downloaded = await FileSystem.downloadAsync(uri, dest);
        sourceUri = downloaded.uri;
      }

      const cropped = await ImageManipulator.manipulateAsync(
        sourceUri,
        [
          {
            crop: {
              originX: Math.round((rect.x - box.x) * scaleX),
              originY: Math.round((rect.y - box.y) * scaleY),
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
        router.back();
      }
    } catch (e) {
      Alert.alert(
        "Could not crop",
        e instanceof Error ? e.message : "Something went wrong.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <ThemedText style={styles.title} lightColor="#fff" darkColor="#fff">
          Adjust photo
        </ThemedText>
        <Pressable
          onPress={handleUse}
          disabled={saving || !naturalSize}
          hitSlop={8}
          style={[styles.iconBtn, (saving || !naturalSize) && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityLabel="Use photo"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="checkmark" size={26} color="#fff" />
          )}
        </Pressable>
      </View>

      <View
        style={styles.displayArea}
        onLayout={(e) =>
          setDisplayArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : null}

        {error ? (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ThemedText lightColor="#fff" darkColor="#fff">
              Could not load this image.
            </ThemedText>
          </View>
        ) : null}

        {box.width > 0 && rect.width > 0 && (
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
              style={[styles.cropRect, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}
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

        {!naturalSize && !error ? (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <ThemedText style={styles.hint} lightColor="#ccc" darkColor="#ccc">
          Drag to move, use the corner handle to resize the frame.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "600" },
  displayArea: {
    flex: 1,
    overflow: "hidden",
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  mask: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  cropRect: {
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
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
  },
});
