import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageSourcePropType, NativePointerEvent, NativeSyntheticEvent } from "react-native";
import {
  Pressable,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";

export type OutfitBoardItem = {
  id: string;
  name: string;
  image: ImageSourcePropType;
  category: string | null;
};

export const OUTFIT_ITEM_W = 110;
export const OUTFIT_ITEM_H = (OUTFIT_ITEM_W * 4) / 3;
const ITEM_W = OUTFIT_ITEM_W;
const ITEM_H = OUTFIT_ITEM_H;
const GRID_GAP = 12;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
// Phone-sized board used for the mini preview on web so items aren't shrunk
// by wide desktop viewports before the canvas is measured.
const WEB_MINI_REF_W = 390;
const WEB_MINI_REF_H = 650;
// Items land on the board 50% bigger than base; pinch adjusts from there.
const DEFAULT_SCALE = 1.5;
// Jewelry/accessories land at half that size, so four of them share the
// footprint of one regular item (a 2x2 grid inside a single grid cell).
const SMALL_SCALE = DEFAULT_SCALE / 2;
const SMALL_CATEGORY_NAMES = new Set(["jewelry", "accessory"]);
// Once the grid runs out of room, extra items overlay earlier ones instead
// of landing off-canvas; each extra wrap cascades by this many pixels.
const OVERFLOW_NUDGE = 20;

function isSmallCategoryItem(item: OutfitBoardItem) {
  return !!item.category && SMALL_CATEGORY_NAMES.has(item.category.toLowerCase());
}

type GridSlot = { cellIndex: number; subPos: number | null };
type GridCursor = { cellIndex: number; pendingSmallCell: number; smallCount: number };

/** Assigns a grid cell to any item not already in `slots`, advancing
 *  `cursor` and mutating `slots` in place. Never revisits an already-slotted
 *  id, so once an item lands on the board it keeps its cell even if earlier
 *  items are later removed — nothing else scoots to fill the gap.
 *  Jewelry/accessory items share a cell four at a time (subPos 0-3, filling
 *  a 2x2 grid), in the order they're first seen. */
function assignNewGridSlots(
  items: OutfitBoardItem[],
  slots: Map<string, GridSlot>,
  cursor: GridCursor,
) {
  for (const item of items) {
    if (slots.has(item.id)) continue;
    if (isSmallCategoryItem(item)) {
      if (cursor.pendingSmallCell === -1) {
        cursor.pendingSmallCell = cursor.cellIndex;
        cursor.cellIndex += 1;
      }
      slots.set(item.id, { cellIndex: cursor.pendingSmallCell, subPos: cursor.smallCount });
      cursor.smallCount += 1;
      if (cursor.smallCount === 4) {
        cursor.pendingSmallCell = -1;
        cursor.smallCount = 0;
      }
    } else {
      slots.set(item.id, { cellIndex: cursor.cellIndex, subPos: null });
      cursor.cellIndex += 1;
    }
  }
}

type ItemTransform = { x: number; y: number; scale: number };

/** Live handles to an item's position shared values, so a group drag can
 *  move every selected item from one gesture on the UI thread. */
type GroupMember = {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  startX: SharedValue<number>;
  startY: SharedValue<number>;
};

const EMPTY_GROUP: GroupMember[] = [];

export type OutfitBoardSnapshot = {
  canvasW: number;
  canvasH: number;
  items: (ItemTransform & { id: string; z: number })[];
};

type DraggableItemProps = {
  item: OutfitBoardItem;
  initial: ItemTransform;
  boundsW: number;
  boundsH: number;
  showDelete: boolean;
  zIndex: number;
  selectMode: boolean;
  selected: boolean;
  /** Selected members (including this item) when this item is selected. */
  group: GroupMember[];
  onToggleSelect: (id: string) => void;
  onRegister: (id: string, member: GroupMember) => () => void;
  onGroupDragEnd: () => void;
  onActivate: (id: string) => void;
  onToggleDelete: (id: string) => void;
  onTransformEnd: (id: string, change: Partial<ItemTransform>) => void;
  onRemove: (id: string) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type WebPointerEvent = NativeSyntheticEvent<NativePointerEvent>;

function pointerClientXY(e: NativePointerEvent) {
  return { x: e.clientX, y: e.clientY, id: e.pointerId, button: e.button };
}

function DraggableBoardItem({
  item,
  initial,
  boundsW,
  boundsH,
  showDelete,
  zIndex,
  selectMode,
  selected,
  group,
  onToggleSelect,
  onRegister,
  onGroupDragEnd,
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
  const panStarted = useSharedValue(false);
  const pinchStarted = useSharedValue(false);
  const pointerIdRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const dragOriginRef = useRef({ px: 0, py: 0, tx: 0, ty: 0 });
  const lastClickAtRef = useRef(0);
  const pinchReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [webItemEl, setWebItemEl] = useState<HTMLElement | null>(null);

  const maxX = Math.max(0, boundsW - ITEM_W);
  const maxY = Math.max(0, boundsH - ITEM_H);

  useEffect(() => {
    tx.value = initial.x;
    ty.value = initial.y;
    scale.value = initial.scale;
  }, [initial.x, initial.y, initial.scale, scale, tx, ty]);

  const groupActive = selectMode && selected && group.length > 0;

  useEffect(
    () => onRegister(item.id, { tx, ty, startX, startY }),
    [item.id, onRegister, tx, ty, startX, startY],
  );

  const activate = useCallback(
    () => onActivate(item.id),
    [item.id, onActivate],
  );
  const toggleSelect = useCallback(
    () => onToggleSelect(item.id),
    [item.id, onToggleSelect],
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

  const queuePinchReport = useCallback(() => {
    if (pinchReportTimerRef.current) clearTimeout(pinchReportTimerRef.current);
    pinchReportTimerRef.current = setTimeout(() => {
      reportScale(scale.value);
      pinchReportTimerRef.current = null;
    }, 120);
  }, [reportScale, scale]);

  const setWebItemRef = useCallback((node: View | null) => {
    setWebItemEl(node as unknown as HTMLElement | null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || !webItemEl) return;

    const onWheel = (event: WheelEvent) => {
      // Trackpad pinch on macOS/Windows arrives as ctrl+wheel.
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();

      activate();
      const factor = Math.exp(-event.deltaY * 0.004);
      const next = clamp(scale.value * factor, MIN_SCALE, MAX_SCALE);
      if (Math.abs(next - scale.value) > 0.001) {
        scale.value = next;
        queuePinchReport();
      }
    };

    webItemEl.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      webItemEl.removeEventListener("wheel", onWheel);
      if (pinchReportTimerRef.current) {
        clearTimeout(pinchReportTimerRef.current);
        pinchReportTimerRef.current = null;
      }
    };
  }, [webItemEl, activate, queuePinchReport, scale]);

  const handleWebPointerDown = useCallback(
    (e: WebPointerEvent) => {
      const { x, y, id, button } = pointerClientXY(e.nativeEvent);
      if (button !== 0) return;

      pointerIdRef.current = id;
      dragMovedRef.current = false;
      dragOriginRef.current = { px: x, py: y, tx: tx.value, ty: ty.value };
      if (groupActive) {
        for (const m of group) {
          m.startX.value = m.tx.value;
          m.startY.value = m.ty.value;
        }
      }
      activate();
      (e.currentTarget as unknown as HTMLElement)?.setPointerCapture?.(id);
    },
    [activate, group, groupActive, tx, ty],
  );

  const handleWebPointerMove = useCallback(
    (e: WebPointerEvent) => {
      const { x, y, id } = pointerClientXY(e.nativeEvent);
      if (pointerIdRef.current !== id) return;

      let dx = x - dragOriginRef.current.px;
      let dy = y - dragOriginRef.current.py;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true;

      if (groupActive) {
        // One shared delta, clamped so every member stays on the canvas.
        for (const m of group) {
          dx = clamp(dx, -m.startX.value, maxX - m.startX.value);
          dy = clamp(dy, -m.startY.value, maxY - m.startY.value);
        }
        for (const m of group) {
          m.tx.value = m.startX.value + dx;
          m.ty.value = m.startY.value + dy;
        }
      } else {
        tx.value = clamp(dragOriginRef.current.tx + dx, 0, maxX);
        ty.value = clamp(dragOriginRef.current.ty + dy, 0, maxY);
      }
    },
    [group, groupActive, maxX, maxY, tx, ty],
  );

  const finishWebPointer = useCallback(
    (e: WebPointerEvent) => {
      const { id } = pointerClientXY(e.nativeEvent);
      if (pointerIdRef.current !== id) return;

      pointerIdRef.current = null;
      (e.currentTarget as unknown as HTMLElement)?.releasePointerCapture?.(id);

      if (dragMovedRef.current) {
        if (groupActive) onGroupDragEnd();
        else reportPosition(tx.value, ty.value);
        return;
      }

      if (selectMode) {
        toggleSelect();
        return;
      }

      const now = Date.now();
      if (now - lastClickAtRef.current < 320) {
        lastClickAtRef.current = 0;
        toggleDelete();
      } else {
        lastClickAtRef.current = now;
      }
    },
    [
      groupActive,
      onGroupDragEnd,
      reportPosition,
      selectMode,
      toggleDelete,
      toggleSelect,
      tx,
      ty,
    ],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .activeOffsetY([-4, 4])
    .onStart(() => {
      if (groupActive) {
        for (const m of group) {
          m.startX.value = m.tx.value;
          m.startY.value = m.ty.value;
        }
      } else {
        startX.value = tx.value;
        startY.value = ty.value;
      }
      panStarted.value = true;
      runOnJS(activate)();
    })
    .onUpdate((e) => {
      if (groupActive) {
        // One shared delta, clamped so every member stays on the canvas —
        // the group moves rigidly instead of squashing at the edges.
        let dx = e.translationX;
        let dy = e.translationY;
        for (const m of group) {
          dx = Math.min(Math.max(dx, -m.startX.value), maxX - m.startX.value);
          dy = Math.min(Math.max(dy, -m.startY.value), maxY - m.startY.value);
        }
        for (const m of group) {
          m.tx.value = m.startX.value + dx;
          m.ty.value = m.startY.value + dy;
        }
      } else {
        tx.value = Math.min(Math.max(startX.value + e.translationX, 0), maxX);
        ty.value = Math.min(Math.max(startY.value + e.translationY, 0), maxY);
      }
    })
    .onFinalize(() => {
      // Only report when the item actually ended up somewhere else, so
      // aborted/no-op gestures don't count as edits.
      if (
        panStarted.value &&
        (tx.value !== startX.value || ty.value !== startY.value)
      ) {
        if (groupActive) {
          runOnJS(onGroupDragEnd)();
        } else {
          runOnJS(reportPosition)(tx.value, ty.value);
        }
      }
      panStarted.value = false;
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      pinchStarted.value = true;
      runOnJS(activate)();
    })
    .onUpdate((e) => {
      scale.value = Math.min(
        Math.max(startScale.value * e.scale, MIN_SCALE),
        MAX_SCALE,
      );
    })
    .onFinalize(() => {
      if (pinchStarted.value && scale.value !== startScale.value) {
        runOnJS(reportScale)(scale.value);
      }
      pinchStarted.value = false;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(!selectMode)
    .onEnd((_e, success) => {
      if (success) runOnJS(toggleDelete)();
    });

  // Single tap: toggles selection in select mode, otherwise brings the item
  // to the front (waits on double-tap failing).
  const singleTap = Gesture.Tap().onEnd((_e, success) => {
    if (!success) return;
    if (selectMode) runOnJS(toggleSelect)();
    else runOnJS(activate)();
  });

  const gesture = Gesture.Exclusive(
    Gesture.Simultaneous(pan, pinch),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const itemBody = (
    <>
      <Image
        source={item.image}
        style={styles.boardItemImage}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
      {selectMode && (
        <View
          pointerEvents="none"
          style={[styles.selectBadge, selected && styles.selectBadgeOn]}
        >
          {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
        </View>
      )}
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
    </>
  );

  const containerStyle = [
    styles.boardItem,
    { zIndex },
    selected && styles.boardItemSelected,
    animatedStyle,
  ];

  if (Platform.OS === "web") {
    return (
      <Animated.View style={containerStyle}>
        <View
          ref={setWebItemRef}
          style={[StyleSheet.absoluteFill, styles.webBoardItem]}
          onPointerDown={handleWebPointerDown}
          onPointerMove={handleWebPointerMove}
          onPointerUp={finishWebPointer}
          onPointerCancel={finishWebPointer}
        >
          {itemBody}
        </View>
      </Animated.View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={containerStyle}>{itemBody}</Animated.View>
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
  onSave: (snapshot: OutfitBoardSnapshot) => void;
  saving?: boolean;
  /** Called the first time the layout actually changes (move/resize/restack). */
  onDirty?: () => void;
  bottomOffset: number;
  /** Opens the board with these transforms (editing a saved outfit).
   *  Read once on mount; positions rescale if the canvas size changed. */
  initialSnapshot?: OutfitBoardSnapshot | null;
  /** Header title shown when expanded. Defaults to "outfit board". */
  title?: string;
};

export function OutfitBoard({
  items,
  expanded,
  onExpand,
  onMinimize,
  onRemoveItem,
  onClose,
  onSave,
  saving,
  onDirty,
  bottomOffset,
  initialSnapshot,
  title = "outfit board",
}: OutfitBoardProps) {
  const win = useWindowDimensions();
  // Remembers where each item was dragged/resized so transforms survive
  // minimize/expand cycles (lives as long as the board is mounted).
  const transformsRef = useRef(new Map<string, Partial<ItemTransform>>());
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const zCounterRef = useRef(1);
  const zOrdersRef = useRef<Record<string, number>>({});
  const [zOrders, setZOrders] = useState<Record<string, number>>({});
  const pendingSnapshotRef = useRef<OutfitBoardSnapshot | null>(
    initialSnapshot ?? null,
  );
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const registryRef = useRef(new Map<string, GroupMember>());
  // Grid cell assignments persist for the life of the board (see
  // assignNewGridSlots) so deleting an item never shifts the others.
  const gridSlotsRef = useRef(new Map<string, GridSlot>());
  const gridCursorRef = useRef<GridCursor>({
    cellIndex: 0,
    pendingSmallCell: -1,
    smallCount: 0,
  });
  assignNewGridSlots(items, gridSlotsRef.current, gridCursorRef.current);
  const gridSlots = gridSlotsRef.current;

  const registerItem = useCallback((id: string, member: GroupMember) => {
    registryRef.current.set(id, member);
    return () => {
      registryRef.current.delete(id);
    };
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const groupMembers = useMemo(
    () =>
      selectMode
        ? [...selectedIds]
            .map((id) => registryRef.current.get(id))
            .filter((m): m is GroupMember => m !== undefined)
        : EMPTY_GROUP,
    [selectMode, selectedIds],
  );

  // A group drag already left every member at its final (clamped) position;
  // commit those positions so they persist and count as an edit.
  const handleGroupDragEnd = useCallback(() => {
    let changed = false;
    for (const id of selectedIds) {
      const m = registryRef.current.get(id);
      if (!m) continue;
      const prev = transformsRef.current.get(id);
      if (prev?.x !== m.tx.value || prev?.y !== m.ty.value) {
        transformsRef.current.set(id, {
          ...prev,
          x: m.tx.value,
          y: m.ty.value,
        });
        changed = true;
      }
    }
    if (changed) onDirty?.();
  }, [selectedIds, onDirty]);

  function toggleSelectMode() {
    if (selectMode) {
      setSelectedIds(new Set());
      setSelectMode(false);
    } else {
      setDeleteTargetId(null);
      setSelectMode(true);
    }
  }

  // Tapping (or dragging/pinching) an item raises it above the others and
  // dismisses a delete badge left open on any other item.
  const bringToFront = useCallback(
    (id: string) => {
      setDeleteTargetId((prev) => (prev === id ? prev : null));
      // Already the sole frontmost item — restacking would be a no-op, so
      // don't count it as an edit.
      const top = zCounterRef.current;
      const tiedAtTop = Object.values(zOrdersRef.current).filter(
        (v) => v === top,
      ).length;
      if (zOrdersRef.current[id] === top && tiedAtTop === 1) return;
      zCounterRef.current += 1;
      zOrdersRef.current = { ...zOrdersRef.current, [id]: zCounterRef.current };
      setZOrders(zOrdersRef.current);
      onDirty?.();
    },
    [onDirty],
  );

  // Items only report transforms that actually changed, so any report here
  // is a real edit.
  const handleTransformEnd = useCallback(
    (id: string, change: Partial<ItemTransform>) => {
      const prev = transformsRef.current.get(id);
      transformsRef.current.set(id, { ...prev, ...change });
      onDirty?.();
    },
    [onDirty],
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

  // Where an item sits right now: its last drag/pinch, or its grid slot.
  // Default slots are sized for the scaled-up footprint, and offset by the
  // center-origin scale overflow so scaled items don't overlap or clip.
  // Jewelry/accessory items get a quarter-cell slot instead (see gridSlots),
  // landing at half scale so four of them tile a single regular cell.
  function resolveTransform(
    id: string,
    canvasW: number,
    canvasH: number,
  ): ItemTransform {
    const cellW = ITEM_W * DEFAULT_SCALE + GRID_GAP;
    const cellH = ITEM_H * DEFAULT_SCALE + GRID_GAP;
    const cols = Math.max(1, Math.floor((canvasW - GRID_GAP) / cellW));
    const rows = Math.max(1, Math.floor((canvasH - GRID_GAP) / cellH));
    const totalCells = cols * rows;
    const saved = transformsRef.current.get(id);
    const slot = gridSlots.get(id);
    const cellIndex = slot?.cellIndex ?? 0;

    // Cells beyond the visible grid wrap back over the front of it instead
    // of landing off-canvas, offset by half a cell so they land in between
    // the items already there — with a further cascade per wrap so repeat
    // overflow doesn't stack exactly on the first overlay layer either.
    const effectiveIndex = cellIndex % totalCells;
    const generation = Math.floor(cellIndex / totalCells);
    const col = effectiveIndex % cols;
    const row = Math.floor(effectiveIndex / cols);
    const cellVisualLeft = GRID_GAP + col * cellW;
    const cellVisualTop = GRID_GAP + row * cellH;
    let nudgeX = 0;
    let nudgeY = 0;
    if (generation > 0) {
      nudgeX = cellW / 2 + (((generation - 1) * OVERFLOW_NUDGE) % (cellW / 2));
      nudgeY = cellH / 2 + (((generation - 1) * OVERFLOW_NUDGE) % (cellH / 2));
    }
    const maxRawX = Math.max(0, canvasW - ITEM_W);
    const maxRawY = Math.max(0, canvasH - ITEM_H);

    if (slot?.subPos !== null && slot?.subPos !== undefined) {
      const halfW = (ITEM_W * DEFAULT_SCALE) / 2;
      const halfH = (ITEM_H * DEFAULT_SCALE) / 2;
      const quadLeft = cellVisualLeft + nudgeX + (slot.subPos % 2) * halfW;
      const quadTop = cellVisualTop + nudgeY + Math.floor(slot.subPos / 2) * halfH;
      const smallOverflowX = (ITEM_W * (SMALL_SCALE - 1)) / 2;
      const smallOverflowY = (ITEM_H * (SMALL_SCALE - 1)) / 2;
      const rawX = quadLeft + smallOverflowX;
      const rawY = quadTop + smallOverflowY;
      return {
        x: saved?.x ?? (generation > 0 ? clamp(rawX, 0, maxRawX) : rawX),
        y: saved?.y ?? (generation > 0 ? clamp(rawY, 0, maxRawY) : rawY),
        scale: saved?.scale ?? SMALL_SCALE,
      };
    }

    const overflowX = (ITEM_W * (DEFAULT_SCALE - 1)) / 2;
    const overflowY = (ITEM_H * (DEFAULT_SCALE - 1)) / 2;
    const rawX = cellVisualLeft + nudgeX + overflowX;
    const rawY = cellVisualTop + nudgeY + overflowY;
    return {
      x: saved?.x ?? (generation > 0 ? clamp(rawX, 0, maxRawX) : rawX),
      y: saved?.y ?? (generation > 0 ? clamp(rawY, 0, maxRawY) : rawY),
      scale: saved?.scale ?? DEFAULT_SCALE,
    };
  }

  function handleCanvasLayout(width: number, height: number) {
    const snap = pendingSnapshotRef.current;
    if (snap && width > 0 && height > 0) {
      pendingSnapshotRef.current = null;
      const fx = snap.canvasW > 0 ? width / snap.canvasW : 1;
      const fy = snap.canvasH > 0 ? height / snap.canvasH : 1;
      let maxZ = zCounterRef.current;
      const seededZ: Record<string, number> = {};
      for (const it of snap.items) {
        transformsRef.current.set(it.id, {
          x: it.x * fx,
          y: it.y * fy,
          scale: it.scale,
        });
        seededZ[it.id] = it.z;
        if (it.z > maxZ) maxZ = it.z;
      }
      zCounterRef.current = maxZ;
      zOrdersRef.current = { ...zOrdersRef.current, ...seededZ };
      setZOrders(zOrdersRef.current);
    }
    setCanvas({ w: width, h: height });
  }

  function handleSavePress() {
    if (saving || items.length === 0 || canvas.w === 0) return;
    onSave({
      canvasW: canvas.w,
      canvasH: canvas.h,
      items: items.map((it) => ({
        id: it.id,
        ...resolveTransform(it.id, canvas.w, canvas.h),
        z: zOrders[it.id] ?? 1,
      })),
    });
  }

  if (!expanded) {
    // Miniature of the actual board. Before the board has ever been
    // expanded the canvas hasn't been measured, so estimate it from the
    // window (the canvas spans the screen width below the header).
    // On web, wide viewports would spread items across many columns and
    // shrink them in the mini preview — use phone-sized refs instead.
    const effW =
      Platform.OS === "web"
        ? WEB_MINI_REF_W
        : canvas.w > 0
          ? canvas.w
          : win.width;
    const effH =
      Platform.OS === "web"
        ? WEB_MINI_REF_H
        : canvas.h > 0
          ? canvas.h
          : Math.max(win.height - 220, 400);
    const miniH = 150;
    const f = miniH / effH;
    const miniW = Math.max(90, Math.round(effW * f));
    return (
      <View style={[styles.miniBoard, { bottom: bottomOffset, left: 16 }]}>
        <Pressable
          onPress={onExpand}
          style={({ pressed }) => [
            { width: miniW, height: miniH },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Expand outfit board"
        >
          {items.map((it) => {
            const t = resolveTransform(it.id, effW, effH);
            return (
              <View
                key={it.id}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: t.x * f,
                  top: t.y * f,
                  width: ITEM_W * f,
                  height: ITEM_H * f,
                  zIndex: zOrders[it.id] ?? 1,
                  transform: [{ scale: t.scale }],
                }}
              >
                <Image
                  source={it.image}
                  style={styles.miniItemImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              </View>
            );
          })}
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
        <ThemedText
          type="defaultSemiBold"
          numberOfLines={1}
          style={styles.fullTitle}
        >
          {title}
        </ThemedText>
        <View style={styles.fullHeaderActions}>
          <Pressable
            onPress={toggleSelectMode}
            style={({ pressed }) => [
              styles.selectBtn,
              selectMode && styles.selectBtnActive,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              selectMode ? "Done selecting items" : "Select multiple items"
            }
          >
            <ThemedText
              style={[
                styles.selectBtnText,
                selectMode && styles.selectBtnTextActive,
              ]}
            >
              {selectMode ? "done" : "select"}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={handleSavePress}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              (pressed || saving) && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save outfit"
          >
            <ThemedText style={styles.saveBtnText}>
              {saving ? "saving…" : "save outfit"}
            </ThemedText>
          </Pressable>
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
        {selectMode
          ? Platform.OS === "web"
            ? "click items to select · drag a selected item to move them together"
            : "tap items to select · drag a selected item to move them together"
          : Platform.OS === "web"
            ? "drag to arrange · pinch trackpad over item to resize · double-click to remove"
            : "drag to arrange · pinch to resize · double-tap to remove"}
      </ThemedText>
      <View
        style={[styles.canvas, Platform.OS === "web" && styles.webCanvas]}
        onLayout={(e) =>
          handleCanvasLayout(
            e.nativeEvent.layout.width,
            e.nativeEvent.layout.height,
          )
        }
      >
        <Pressable
          style={[StyleSheet.absoluteFill, styles.canvasDismiss]}
          onPress={() => setDeleteTargetId(null)}
          accessibilityLabel="Dismiss remove button"
        />
        {canvas.w > 0 &&
          items.map((it) => {
            const initial = resolveTransform(it.id, canvas.w, canvas.h);
            return (
              <DraggableBoardItem
                key={it.id}
                item={it}
                initial={initial}
                boundsW={canvas.w}
                boundsH={canvas.h}
                showDelete={deleteTargetId === it.id}
                zIndex={zOrders[it.id] ?? 1}
                selectMode={selectMode}
                selected={selectedIds.has(it.id)}
                group={selectedIds.has(it.id) ? groupMembers : EMPTY_GROUP}
                onToggleSelect={handleToggleSelect}
                onRegister={registerItem}
                onGroupDragEnd={handleGroupDragEnd}
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
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#C6C6C8", // same as the saved-board cards on the boards tab
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  miniItemImage: {
    width: "100%",
    height: "100%",
  },
  miniClose: {
    position: "absolute",
    top: 2,
    right: 2,
    padding: 3,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.85)",
    zIndex: 1000,
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
    gap: 16,
  },
  selectBtn: {
    borderWidth: 1,
    borderColor: "#000",
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  selectBtnActive: {
    backgroundColor: "#000",
  },
  selectBtnText: {
    color: "#000",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 16,
  },
  selectBtnTextActive: {
    color: "#fff",
  },
  saveBtn: {
    backgroundColor: "#000",
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 16,
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
  webCanvas: {
    touchAction: "none",
    overscrollBehavior: "contain",
  } as object,
  canvasDismiss: {
    zIndex: 0,
  },
  boardItem: {
    position: "absolute",
    left: 0,
    top: 0,
    width: ITEM_W,
    height: ITEM_H,
  },
  boardItemSelected: {
    borderWidth: 2,
    borderColor: "#0A84FF",
    borderRadius: 10,
  },
  selectBadge: {
    position: "absolute",
    top: -6,
    left: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#0A84FF",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  selectBadgeOn: {
    backgroundColor: "#0A84FF",
  },
  webBoardItem: {
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  } as object,
  boardItemImage: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
    pointerEvents: "none",
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
