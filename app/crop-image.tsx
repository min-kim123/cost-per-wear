import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { emitImageCaptured, emitImagesCaptured } from "@/lib/image-capture-bridge";

const MIN_RECT_SIZE = 60;

type Rect = { x: number; y: number; width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };
type Offset = { x: number; y: number };
type Edges = { left?: boolean; top?: boolean; right?: boolean; bottom?: boolean };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// returnTo values:
//   "edit"    → single image; emits the cropped uri back to edit-closet-item.
//   "add"     → emits all cropped uris back to add-closet-item (already on the stack).
//   "add-new" → replaces this screen with add-closet-item (library picks from the closet FAB).
export default function CropImageScreen() {
  const router = useRouter();
  const { uri, uris, returnTo, id } = useLocalSearchParams<{
    uri?: string;
    uris?: string;
    returnTo?: string;
    id?: string;
  }>();
  const insets = useSafeAreaInsets();

  const uriList = useMemo<string[]>(() => {
    if (typeof uris === "string" && uris) {
      try {
        const parsed = JSON.parse(uris);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // fall through to single uri
      }
    }
    return typeof uri === "string" && uri ? [uri] : [];
  }, [uri, uris]);

  const [index, setIndex] = useState(0);
  const croppedRef = useRef<string[]>([]);
  const currentUri = uriList[index];

  const [displayArea, setDisplayArea] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  // How far the photo has been dragged from its centered position.
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const rectRef = useRef(rect);
  rectRef.current = rect;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const boxRef = useRef<Box>({ x: 0, y: 0, width: 0, height: 0 });
  const areaRef = useRef(displayArea);
  areaRef.current = displayArea;

  const panStart = useRef<Offset>({ x: 0, y: 0 });
  const resizeStartRect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });

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
    if (!currentUri) return;
    setError(false);
    RNImage.getSize(
      currentUri,
      (width, height) => setNaturalSize({ width, height }),
      () => setError(true),
    );
  }, [currentUri, index]);

  // Start with the crop frame covering the whole photo — no preset aspect ratio.
  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    setRect((r) =>
      r.width === 0
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : r,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.width, box.height]);

  // Dragging anywhere outside the handles moves the photo under the crop
  // frame (the frame itself stays put), like the Photos app.
  const imagePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panStart.current = { ...offsetRef.current };
      },
      onPanResponderMove: (_evt, gesture) => {
        const b = boxRef.current;
        const r = rectRef.current;
        if (r.width === 0 || b.width === 0) return;
        // The photo may only move as far as keeps the crop frame fully covered.
        const minX = r.x + r.width - (b.x + b.width);
        const maxX = r.x - b.x;
        const minY = r.y + r.height - (b.y + b.height);
        const maxY = r.y - b.y;
        setOffset({
          x: clamp(panStart.current.x + gesture.dx, minX, maxX),
          y: clamp(panStart.current.y + gesture.dy, minY, maxY),
        });
      },
    }),
  ).current;

  // One responder per corner/edge handle; each moves only its own edges,
  // clamped to the photo (as currently panned) and the visible area.
  function makeResizeResponder(edges: Edges) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        resizeStartRect.current = { ...rectRef.current };
      },
      onPanResponderMove: (_evt, gesture) => {
        const start = resizeStartRect.current;
        const b = boxRef.current;
        const off = offsetRef.current;
        const area = areaRef.current;
        if (start.width === 0 || b.width === 0) return;
        const boundLeft = Math.max(b.x + off.x, 0);
        const boundTop = Math.max(b.y + off.y, 0);
        const boundRight = Math.min(b.x + off.x + b.width, area.width);
        const boundBottom = Math.min(b.y + off.y + b.height, area.height);

        let { x, y, width, height } = start;
        if (edges.left) {
          const newX = clamp(start.x + gesture.dx, boundLeft, start.x + start.width - MIN_RECT_SIZE);
          width = start.x + start.width - newX;
          x = newX;
        }
        if (edges.right) {
          width = clamp(start.width + gesture.dx, MIN_RECT_SIZE, boundRight - start.x);
        }
        if (edges.top) {
          const newY = clamp(start.y + gesture.dy, boundTop, start.y + start.height - MIN_RECT_SIZE);
          height = start.y + start.height - newY;
          y = newY;
        }
        if (edges.bottom) {
          height = clamp(start.height + gesture.dy, MIN_RECT_SIZE, boundBottom - start.y);
        }
        setRect({ x, y, width, height });
      },
    });
  }

  const handleResponders = useRef({
    topLeft: makeResizeResponder({ left: true, top: true }),
    topRight: makeResizeResponder({ right: true, top: true }),
    bottomLeft: makeResizeResponder({ left: true, bottom: true }),
    bottomRight: makeResizeResponder({ right: true, bottom: true }),
    top: makeResizeResponder({ top: true }),
    bottom: makeResizeResponder({ bottom: true }),
    left: makeResizeResponder({ left: true }),
    right: makeResizeResponder({ right: true }),
  }).current;

  async function handleUse() {
    if (saving || !naturalSize || box.width === 0) return;
    setSaving(true);
    try {
      const scaleX = naturalSize.width / box.width;
      const scaleY = naturalSize.height / box.height;
      const imgLeft = box.x + offset.x;
      const imgTop = box.y + offset.y;

      // ImageManipulator can't render directly from a remote URL on native;
      // it needs a local file (web's implementation handles remote URLs fine).
      let sourceUri = currentUri;
      if (Platform.OS !== "web" && /^https?:\/\//i.test(currentUri)) {
        const ext = currentUri.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
        const safeExt = ext && /^[a-z0-9]{2,4}$/.test(ext) ? ext : "jpg";
        const dest = `${FileSystem.cacheDirectory}crop-src-${Date.now()}.${safeExt}`;
        const downloaded = await FileSystem.downloadAsync(currentUri, dest);
        sourceUri = downloaded.uri;
      }

      const originX = clamp(Math.round((rect.x - imgLeft) * scaleX), 0, naturalSize.width - 1);
      const originY = clamp(Math.round((rect.y - imgTop) * scaleY), 0, naturalSize.height - 1);
      const cropped = await ImageManipulator.manipulateAsync(
        sourceUri,
        [
          {
            crop: {
              originX,
              originY,
              width: clamp(Math.round(rect.width * scaleX), 1, naturalSize.width - originX),
              height: clamp(Math.round(rect.height * scaleY), 1, naturalSize.height - originY),
            },
          },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );

      croppedRef.current = [...croppedRef.current, cropped.uri];

      // More images in the queue → reset and crop the next one.
      if (index < uriList.length - 1) {
        setNaturalSize(null);
        setRect({ x: 0, y: 0, width: 0, height: 0 });
        setOffset({ x: 0, y: 0 });
        setIndex(index + 1);
        return;
      }

      if (returnTo === "add") {
        emitImagesCaptured(croppedRef.current);
        router.back();
      } else if (returnTo === "add-new") {
        router.replace({
          pathname: "/add-closet-item",
          params: { capturedUris: JSON.stringify(croppedRef.current) },
        });
      } else if (returnTo === "edit" && id) {
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
          {uriList.length > 1
            ? `Adjust photo ${index + 1} of ${uriList.length}`
            : "Adjust photo"}
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
        {...imagePanResponder.panHandlers}
      >
        {currentUri ? (
          <Image
            source={{ uri: currentUri }}
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateX: offset.x }, { translateY: offset.y }] },
            ]}
            contentFit="contain"
          />
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
              {/* Corner handles */}
              <View style={[styles.handleTouch, styles.touchTL]} {...handleResponders.topLeft.panHandlers}>
                <View style={[styles.cornerMark, styles.cornerTL]} />
              </View>
              <View style={[styles.handleTouch, styles.touchTR]} {...handleResponders.topRight.panHandlers}>
                <View style={[styles.cornerMark, styles.cornerTR]} />
              </View>
              <View style={[styles.handleTouch, styles.touchBL]} {...handleResponders.bottomLeft.panHandlers}>
                <View style={[styles.cornerMark, styles.cornerBL]} />
              </View>
              <View style={[styles.handleTouch, styles.touchBR]} {...handleResponders.bottomRight.panHandlers}>
                <View style={[styles.cornerMark, styles.cornerBR]} />
              </View>
              {/* Edge handles */}
              <View style={[styles.handleTouch, styles.touchTop]} {...handleResponders.top.panHandlers}>
                <View style={styles.hBar} />
              </View>
              <View style={[styles.handleTouch, styles.touchBottom]} {...handleResponders.bottom.panHandlers}>
                <View style={styles.hBar} />
              </View>
              <View style={[styles.handleTouch, styles.touchLeft]} {...handleResponders.left.panHandlers}>
                <View style={styles.vBar} />
              </View>
              <View style={[styles.handleTouch, styles.touchRight]} {...handleResponders.right.panHandlers}>
                <View style={styles.vBar} />
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
          Drag the photo to position it. Drag the corners or edges to resize the frame.
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
    borderWidth: 1.5,
    borderColor: "#fff",
  },

  // ── Crop handles (Photos-style corner brackets + edge bars) ────────
  handleTouch: {
    position: "absolute",
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  touchTL: { left: -18, top: -18 },
  touchTR: { right: -18, top: -18 },
  touchBL: { left: -18, bottom: -18 },
  touchBR: { right: -18, bottom: -18 },
  touchTop: { top: -18, left: "50%", marginLeft: -18 },
  touchBottom: { bottom: -18, left: "50%", marginLeft: -18 },
  touchLeft: { left: -18, top: "50%", marginTop: -18 },
  touchRight: { right: -18, top: "50%", marginTop: -18 },
  cornerMark: {
    position: "absolute",
    width: 20,
    height: 20,
    borderColor: "#fff",
  },
  cornerTL: { left: 14, top: 14, borderLeftWidth: 3, borderTopWidth: 3 },
  cornerTR: { right: 14, top: 14, borderRightWidth: 3, borderTopWidth: 3 },
  cornerBL: { left: 14, bottom: 14, borderLeftWidth: 3, borderBottomWidth: 3 },
  cornerBR: { right: 14, bottom: 14, borderRightWidth: 3, borderBottomWidth: 3 },
  hBar: { width: 26, height: 4, borderRadius: 2, backgroundColor: "#fff" },
  vBar: { width: 4, height: 26, borderRadius: 2, backgroundColor: "#fff" },

  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
  },
});
