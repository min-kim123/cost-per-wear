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

// Same idea, but for flows that produce several images at once
// (e.g. cropping a library multi-select before adding to the closet).
type MultiListener = (uris: string[]) => void;

let multiListener: MultiListener | null = null;

export function onImagesCaptured(cb: MultiListener): () => void {
  multiListener = cb;
  return () => {
    if (multiListener === cb) multiListener = null;
  };
}

export function emitImagesCaptured(uris: string[]) {
  multiListener?.(uris);
}
