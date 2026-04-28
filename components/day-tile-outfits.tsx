import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

const MAX_VISIBLE = 4;

type Props = {
  imageUris: string[];
};

/**
 * Up to 4 clothing item images in one calendar cell; 5+ shows +N in the 4th slot.
 * Parent handles taps (e.g. navigate to day outfits).
 */
export function DayTileOutfits({ imageUris }: Props) {
  const count = imageUris.length;
  if (count === 0) {
    return <View style={styles.placeholder} />;
  }

  const visible = imageUris.slice(0, MAX_VISIBLE);
  const overflow = count > MAX_VISIBLE ? count - MAX_VISIBLE : 0;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {count === 1 && (
        <Image source={{ uri: visible[0] }} style={styles.full} contentFit="cover" />
      )}
      {count === 2 && (
        <View style={styles.col}>
          <Image source={{ uri: visible[0] }} style={styles.half} contentFit="cover" />
          <View style={styles.gapH} />
          <Image source={{ uri: visible[1] }} style={styles.half} contentFit="cover" />
        </View>
      )}
      {count === 3 && (
        <View style={styles.col}>
          <View style={styles.row}>
            <Image source={{ uri: visible[0] }} style={styles.quad} contentFit="cover" />
            <View style={styles.gapV} />
            <Image source={{ uri: visible[1] }} style={styles.quad} contentFit="cover" />
          </View>
          <View style={styles.gapH} />
          <Image source={{ uri: visible[2] }} style={styles.thirdBottom} contentFit="cover" />
        </View>
      )}
      {(count === 4 || count > 4) && (
        <View style={styles.col}>
          <View style={styles.row}>
            <Image source={{ uri: visible[0] }} style={styles.quad} contentFit="cover" />
            <View style={styles.gapV} />
            <Image source={{ uri: visible[1] }} style={styles.quad} contentFit="cover" />
          </View>
          <View style={styles.gapH} />
          <View style={styles.row}>
            <Image source={{ uri: visible[2] }} style={styles.quad} contentFit="cover" />
            <View style={styles.gapV} />
            {overflow > 0 ? (
              <View style={styles.moreBox}>
                <Text style={styles.moreText}>+{overflow}</Text>
              </View>
            ) : (
              <Image source={{ uri: visible[3] }} style={styles.quad} contentFit="cover" />
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const GAP = 1;

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    width: "100%",
    minHeight: 36,
    overflow: "hidden",
  },
  placeholder: {
    flex: 1,
    width: "100%",
    minHeight: 36,
  },
  full: {
    width: "100%",
    height: "100%",
  },
  col: {
    flex: 1,
    flexDirection: "column",
  },
  row: {
    flex: 1,
    flexDirection: "row",
  },
  half: {
    flex: 1,
    width: "100%",
  },
  quad: {
    flex: 1,
    height: "100%",
  },
  thirdBottom: {
    flex: 1,
    width: "100%",
  },
  gapH: {
    height: GAP,
  },
  gapV: {
    width: GAP,
  },
  moreBox: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});
