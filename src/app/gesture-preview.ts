import type {
  ObjectGesturePreview,
  ObjectGesturePreviewSource,
} from '../contracts/ui';

export type ObjectGesturePreviewChannel = ObjectGesturePreviewSource & {
  publish: (preview: ObjectGesturePreview) => void;
};

/**
 * A tiny external store for pointer-rate updates. App owns one channel, the
 * equipment layer writes to it and only the properties card subscribes.
 */
export function createObjectGesturePreviewChannel(): ObjectGesturePreviewChannel {
  let snapshot: ObjectGesturePreview = null;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (preview) => {
      if (
        snapshot?.objectId === preview?.objectId &&
        snapshot?.position[0] === preview?.position[0] &&
        snapshot?.position[1] === preview?.position[1]
      ) {
        return;
      }
      snapshot = preview;
      for (const listener of listeners) listener();
    },
  };
}