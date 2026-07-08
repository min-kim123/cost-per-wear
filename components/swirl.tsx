import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

// A small spiral drawn from three nested semicircle arcs. When `loosened`,
// the arcs spread apart and the whole swirl rotates back — it "unravels".
// Toggling animates smoothly in both directions.

const SIZE = 22;
const STROKE = 1;

type Props = {
  loosened: boolean;
  color: string;
};

export function Swirl({ loosened, color }: Props) {
  const progress = useRef(new Animated.Value(loosened ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: loosened ? 1 : 0,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [loosened, progress]);

  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-80deg"],
  });
  // Each arc drifts outward by a different amount so the coil visibly opens.
  const outerScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const middleScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const innerScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });

  return (
    <Animated.View style={[styles.box, { transform: [{ rotate }] }]}>
      <Animated.View
        style={[styles.arc, styles.outerArc, { borderColor: color, transform: [{ scale: outerScale }] }]}
      />
      <Animated.View
        style={[styles.arc, styles.middleArc, { borderColor: color, transform: [{ scale: middleScale }] }]}
      />
      <Animated.View
        style={[styles.arc, styles.innerArc, { borderColor: color, transform: [{ scale: innerScale }] }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
  },
  arc: {
    position: "absolute",
    borderWidth: STROKE,
  },
  // Top half-circle, radius 8, centered on (11, 11).
  outerArc: {
    left: 3,
    top: 3,
    width: 16,
    height: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomWidth: 0,
  },
  // Bottom half-circle, radius 6, centered on (9, 11) — joins the outer arc
  // at its left end and hands off to the inner arc at its right.
  middleArc: {
    left: 3,
    top: 11,
    width: 12,
    height: 6,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderTopWidth: 0,
  },
  // Top half-circle, radius 4, centered on (11, 11).
  innerArc: {
    left: 7,
    top: 7,
    width: 8,
    height: 4,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomWidth: 0,
  },
});
