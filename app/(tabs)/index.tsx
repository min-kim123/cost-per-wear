import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import { useRouter } from "expo-router";
import {
  Alert,
  PanResponder,
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
} from "react-native";

import { copyUriToDraft } from "@/lib/outfit-storage";
import { subscribeHomeCameraReset } from "@/lib/home-camera-reset";

export default function HomeScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  useEffect(() => {
    return subscribeHomeCameraReset(() => {
      setPreviewUri(null);
      setCapturing(false);
      setCameraReady(false);
    });
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          const { dx, dy } = gestureState;
          return Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const { dx, vx } = gestureState;
          if (dx < -50 && Math.abs(vx) > 0.2) {
            router.push("/(tabs)/closet");
          } else if (dx > 50 && Math.abs(vx) > 0.2) {
            router.push("/(tabs)/calendar");
          }
        },
      }),
    [router],
  );

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      if (!photo?.uri) {
        throw new Error("No image returned");
      }
      const draft = await copyUriToDraft(photo.uri);
      setPreviewUri(draft);
    } catch (e) {
      Alert.alert("Camera", e instanceof Error ? e.message : "Could not take photo");
    } finally {
      setCapturing(false);
    }
  }, [cameraReady, capturing]);

  const handleRetake = useCallback(() => {
    setPreviewUri(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!previewUri) return;
    router.push("/select-outfit-items");
  }, [previewUri, router]);

  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>
          We use your camera so you can capture today&apos;s outfit.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const panHandlers = previewUri ? {} : panResponder.panHandlers;

  return (
    <View style={styles.container} {...panHandlers}>
      {previewUri ? (
        <>
          <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={styles.roundAction}
              onPress={handleRetake}
              accessibilityLabel="Retake photo"
            >
              <Ionicons name="close" size={36} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.roundAction}
              onPress={handleConfirm}
              accessibilityLabel="Use photo and pick items"
            >
              <Ionicons name="checkmark" size={36} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="picture"
            onCameraReady={() => setCameraReady(true)}
          />
          <View style={styles.captureBar}>
            <TouchableOpacity
              style={[styles.captureButton, (!cameraReady || capturing) && styles.captureDisabled]}
              onPress={handleCapture}
              disabled={!cameraReady || capturing}
              accessibilityLabel="Capture outfit photo"
            >
              {capturing ? (
                <ActivityIndicator color="#fff" />
              ) : null}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  permissionButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "black",
  },
  permissionButtonText: {
    color: "white",
    fontWeight: "600",
  },
  captureBar: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "white",
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  captureDisabled: {
    opacity: 0.6,
  },
  previewActions: {
    position: "absolute",
    bottom: 48,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  roundAction: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
  },
});
