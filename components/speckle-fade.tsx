import { StyleSheet, View } from "react-native";

// Dithered edge shading: grey dots dense at one edge, thinning and fading
// away from it. Seeded so the pattern is stable across renders. Positions
// absolutely inside its parent along the given edge; touches pass through.

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECKLES = (() => {
  const rand = mulberry32(7);
  return Array.from({ length: 110 }, () => {
    const depth = 1 - Math.sqrt(rand()); // 0 = at the edge; biased dense toward it
    return {
      x: rand() * 100,
      depth,
      size: 1.5 + rand() * 2,
      opacity: (0.3 + rand() * 0.4) * (1 - depth),
    };
  });
})();

export function SpeckleFade({
  height,
  edge,
}: {
  height: number;
  edge: "top" | "bottom";
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.layer,
        { height },
        edge === "top" ? { top: 0 } : { bottom: 0 },
      ]}
    >
      {SPECKLES.map((s, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            [edge]: s.depth * height,
            width: s.size,
            height: s.size,
            borderRadius: s.size / 2,
            backgroundColor: `rgba(128,128,128,${s.opacity.toFixed(3)})`,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1,
    overflow: "hidden",
  },
});
