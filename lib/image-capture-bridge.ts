// Bridges a captured/cropped image back to a screen already on the nav stack
// (e.g. edit-closet-item) so a capture flow can router.back() into it instead
// of pushing a duplicate screen with route params.
type Listener = (uri: string) => void;

let listener: Listener | null = null;

export function onImageCaptured(cb: Listener): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}

export function emitImageCaptured(uri: string) {
  listener?.(uri);
}
