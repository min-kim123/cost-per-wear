import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useRef, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";

export type OutfitBoardItem = {
  id: string;
  name: string;
  image: ImageSourcePropType;
};

const ITEM_W = 110;
const ITEM_H = (ITEM_W * 4) / 3;
const GRID_GAP = 12;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;

type ItemTransform = { x: number; y: number; scale: number };

type DraggableItemProps = {
  item: OutfitBoardItem;
  initial: ItemTransform;
  boundsW: number;
  boundsH: number;
  showDelete: boolean;
  zIndex: number;
  onActivate: (id: string) => void;
  onToggleDelete: (id: string) => void;
  onTransformEnd: (id: string, change: Partial<ItemTransform>) => void;
  onRemove: (id: string) => void;
};

function DraggableBoardItem({
  item,
  initial,
  boundsW,
  boundsH,
  showDelete,
  zIndex,
  onActivate,
  onToggleDelete,
  onTransformEnd,
  onRemove,
}: DraggableItemProps) {
  const tx = useSharedValue(initial.x);
  const ty = useSharedValue(initial.y);
  const scale = useSharedValue(initial.scale);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const maxX = Math.max(0, boundsW - ITEM_W);
  const maxY = Math.max(0, boundsH - ITEM_H);

  const activate = useCallback(
    () => onActivate(item.id),
    [item.id, onActivate],
  );
  const toggleDelete = useCallback(() => {
    onActivate(item.id);
    onToggleDelete(item.id);
  }, [item.id, onActivate, onToggleDelete]);
  const reportPosition = useCallback(
    (x: number, y: number) => onTransformEnd(item.id, { x, y }),
    [item.id, onTransformEnd],
  );
  const reportScale = useCallback(
    (s: number) => onTransformEnd(item.id, { scale: s }),
    [item.id, onTransformEnd],
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
      runOnJS(activate)();
    })
    .onUpdate((e) => {
      tx.value = Math.min(Math.max(startX.value + e.translationX, 0), maxX);
      ty.value = Math.min(Math.max(startY.value + e.translationY, 0), maxY);
    })
    .onFinalize(() => {
      runOnJS(reportPosition)(tx.value, ty.value);
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      runOnJS(activate)();
    })
    .onUpdate((e) => {
      scale.value = Math.min(
        Math.max(startScale.value * e.scale, MIN_SCALE),
        MAX_SCALE,
      );
    })
    .onFinalize(() => {
      runOnJS(reportScale)(scale.value);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, success) => {
      if (success) runOnJS(toggleDelete)();
    });

  // Single tap brings the item to the front (waits on double-tap failing).
  const singleTap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(activate)();
  });

  const gesture = Gesture.Race(
    Gesture.Exclusive(doubleTap, singleTap),
    Gesture.Simultaneous(pan, pinch),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.boardItem, { zIndex }, animatedStyle]}>
        <Image
          source={item.image}
          style={styles.boardItemImage}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
        {showDelete && (
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={8}
            style={styles.deleteBadge}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from outfit`}
          >
            <Ionicons name="trash" size={14} color="#fff" />
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

type OutfitBoardProps = {
  items: OutfitBoardItem[];
  expanded: boolean;
  onExpand: () => void;
  onMinimize: () => void;
  onRemoveItem: (id: string) => void;
  onClose: () => void;
  bottomOffset: number;
};

export function OutfitBoard({
  items,
  expanded,
  onExpand,
  onMinimize,
  onRemoveItem,
  onClose,
  bottomOffset,
}: OutfitBoardProps) {
  // Remembers where each item was dragged/resized so transforms survive
  // minimize/expand cycles (lives as long as the board is mounted).
  const transformsRef = useRef(new Map<string, Partial<ItemTransform>>());
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const zCounterRef = useRef(1);
  const [zOrders, setZOrders] = useState<Record<string, number>>({});

  // Tapping (or dragging/pinching) an item raises it above the others and
  // dismisses a delete badge left open on any other item.
  const bringToFront = useCallback((id: string) => {
    zCounterRef.current += 1;
    setZOrders((prev) => ({ ...prev, [id]: zCounterRef.current }));
    setDeleteTargetId((prev) => (prev === id ? prev : null));
  }, []);

  const handleTransformEnd = useCallback(
    (id: string, change: Partial<ItemTransform>) => {
      const prev = transformsRef.current.get(id);
      transformsRef.current.set(id, { ...prev, ...change });
    },
    [],
  );

  const handleToggleDelete = useCallback((id: string) => {
    setDeleteTargetId((prev) => (prev === id ? null : id));
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      setDeleteTargetId(null);
      onRemoveItem(id);
    },
    [onRemoveItem],
  );

  if (!expanded) {
    const previews = items.slice(0, 3);
    const extra = items.length - previews.length;
    return (
      <View style={[styles.miniBoard, { bottom: bottomOffset, left: 16 }]}>
        <Pressable
          onPress={onExpand}
          style={({ pressed }) => [
            styles.miniBoardContent,
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Expand outfit board"
        >
          {previews.map((it) => (
            <Image
              key={it.id}
              source={it.image}
              style={styles.miniThumb}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ))}
          {extra > 0 && (
            <ThemedText style={styles.miniExtra}>+{extra}</ThemedText>
          )}
          <Ionicons name="expand-outline" size={16} color="#666" />
        </Pressable>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={styles.miniClose}
          accessibilityRole="button"
          accessibilityLabel="Discard outfit"
        >
          <Ionicons name="close" size={14} color="#666" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fullBoard}>
      <View style={styles.fullHeader}>
        <ThemedText type="defaultSemiBold" style={styles.fullTitle}>
          Outfit board
        </ThemedText>
        <View style={styles.fullHeaderActions}>
          <Pressable
            onPress={onMinimize}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Minimize outfit board"
          >
            <Ionicons name="contract-outline" size={22} color="#000" />
          </Pressable>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Discard outfit"
          >
            <Ionicons name="close" size={24} color="#000" />
          </Pressable>
        </View>
      </View>
      <ThemedText style={styles.fullHint}>
        Drag to arrange · pinch to resize · double-tap to remove
      </ThemedText>
      <View
        style={styles.canvas}
        onLayout={(e) =>
          setCanvas({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setDeleteTargetId(null)}
          accessibilityLabel="Dismiss remove button"
        />
        {canvas.w > 0 &&
          items.map((it, i) => {
            const saved = transformsRef.current.get(it.id);
            const cols = Math.max(
              1,
              Math.floor((canvas.w - GRID_GAP) / (ITEM_W + GRID_GAP)),
            );
            const initial: ItemTransform = {
              x: saved?.x ?? GRID_GAP + (i % cols) * (ITEM_W + GRID_GAP),
              y:
                saved?.y ??
                GRID_GAP + Math.floor(i / cols) * (ITEM_H + GRID_GAP),
              scale: saved?.scale ?? 1,
            };
            return (
              <DraggableBoardItem
                key={it.id}
                item={it}
                initial={initial}
                boundsW={canvas.w}
                boundsH={canvas.h}
                showDelete={deleteTargetId === it.id}
                zIndex={zOrders[it.id] ?? 1}
                onActivate={bringToFront}
                onToggleDelete={handleToggleDelete}
                onTransformEnd={handleTransformEnd}
                onRemove={handleRemove}
              />
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  miniBoard: {
    position: "absolute",
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  miniBoardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  miniThumb: {
    width: 34,
    height: 44,
    borderRadius: 6,
    backgroundColor: "#f2f2f7",
  },
  miniExtra: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
  },
  miniClose: {
    marginLeft: 8,
    padding: 4,
  },
  fullBoard: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    zIndex: 30,
    elevation: 30,
  },
  fullHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  fullHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  fullTitle: {
    fontSize: 17,
    color: "#000",
  },
  fullHint: {
    fontSize: 12,
    color: "#8E8E93",
    paddingHorizontal: 16,
    paddingTop: 2,
  },
  canvas: {
    flex: 1,
    marginTop: 8,
  },
  boardItem: {
    position: "absolute",
    left: 0,
    top: 0,
    width: ITEM_W,
    height: ITEM_H,
  },
  boardItemImage: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
  },
  deleteBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
