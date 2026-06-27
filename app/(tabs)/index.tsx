import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter } from "expo-router";
import {
  Alert,
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
  const [facing, setFacing] = useState<"back" | "front">("back");
  const lastTapRef = useRef<number>(0);

  useEffect(() => {
    return subscribeHomeCameraReset(() => {
      setPreviewUri(null);
      setCapturing(false);
      setCameraReady(false);
    });
  }, []);

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
    setCameraReady(false);
  }, []);

  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setCameraReady(false);
      setFacing((f) => (f === "back" ? "front" : "back"));
    }
    lastTapRef.current = now;
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

  return (
    <View style={styles.container}>
      {previewUri ? (
        <>
          <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" />
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
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={handleDoubleTap}
            accessibilityLabel="Double-tap to flip camera"
          >
            <CameraView
              key={facing}
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode="picture"
              onCameraReady={() => setCameraReady(true)}
            />
          </TouchableOpacity>
          <View style={styles.captureBar}>
            <TouchableOpacity
              style={styles.flipButton}
              onPress={() => { setCameraReady(false); setFacing((f) => (f === "back" ? "front" : "back")); }}
              accessibilityLabel="Flip camera"
            >
              <Ionicons name="camera-reverse-outline" size={28} color="#fff" />
            </TouchableOpacity>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  flipButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.4)",
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
