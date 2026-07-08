import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { OUTFIT_ITEM_H, OUTFIT_ITEM_W } from "@/components/outfit-board";

export type StaticBoardItem = {
  id: string;
  x: number;
  y: number;
  scale: number;
  z: number;
  image: string | null;
};

type Props = {
  canvasW: number;
  canvasH: number;
  items: StaticBoardItem[];
  style?: StyleProp<ViewStyle>;
};

/** Read-only render of a saved outfit board: items placed by percentage of
 *  the original canvas, so it reproduces the live board's arrangement at
 *  any size without needing to measure the container. Fills whatever box
 *  the caller gives it (a fixed-size cell, or a parent sized via aspectRatio
 *  to canvasW/canvasH to avoid distortion) — it doesn't size itself. */
export function StaticOutfitBoard({ canvasW, canvasH, items, style }: Props) {
  if (canvasW <= 0 || canvasH <= 0) return null;
  const itemWPct = (OUTFIT_ITEM_W / canvasW) * 100;
  const itemHPct = (OUTFIT_ITEM_H / canvasH) * 100;

  return (
    <View style={[styles.wrapper, style]}>
      {items.map((it) => (
        <View
          key={it.id}
          style={{
            position: "absolute",
            left: `${(it.x / canvasW) * 100}%`,
            top: `${(it.y / canvasH) * 100}%`,
            width: `${itemWPct}%`,
            height: `${itemHPct}%`,
            zIndex: it.z,
            transform: [{ scale: it.scale }],
          }}
        >
          {it.image && (
            <Image
              source={{ uri: it.image }}
              style={styles.image}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
