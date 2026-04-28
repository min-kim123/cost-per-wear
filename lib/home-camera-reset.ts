/** Lets Home reset to the live camera after outfit save (modal doesn't unmount Home). */

type Unsubscribe = () => void;

let listener: (() => void) | null = null;

export function subscribeHomeCameraReset(callback: () => void): Unsubscribe {
  listener = callback;
  return () => {
    listener = null;
  };
}

export function requestHomeCameraReset(): void {
  listener?.();
}
