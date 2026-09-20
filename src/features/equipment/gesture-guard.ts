/**
 * U04: what a gesture over an object remembers between `dragstart` and
 * `dragend`, and who decides whether it reaches the store.
 *
 * Escape arrives in the middle of a drag and knows nothing about Konva, while
 * the order of Konva's own events is not guaranteed: `stopDrag()` may call
 * `dragend` right away, a frame later, or never if the node is gone by then.
 * So the cancellation is kept here until the gesture ends and is cleared only
 * by the next `begin()` — never by the code that set it.
 *
 * The guard also holds the node being dragged: only this layer's own gesture is
 * ever cancelled, so Escape cannot stop a vertex or a wall end that another
 * layer is dragging on the same stage.
 */

import type { Point } from '../../contracts/model';
import type { SnapGuides } from '../../domain/geometry';

/** The part of a Konva node a cancelled gesture needs; a test passes a stub. */
export type GestureNode = {
  position(point: { x: number; y: number }): unknown;
  stopDrag(): void;
  /** Konva: true only while this node is the one being dragged. */
  isDragging(): boolean;
};

export type GestureStart = {
  node: GestureNode;
  /** Screen position of the node when the gesture started. */
  origin: { x: number; y: number };
  /** Offset from the pointer to the grabbed handle, in world metres. */
  grab: Point;
  /** What a move may snap to (D-208); absent for gestures that do not snap. */
  guides?: SnapGuides;
  /** Alt as seen at the last move: the drop must land where the drag showed it. */
  snapOff?: boolean;
};

export type GestureGuard = {
  /** `dragstart`: a new gesture, whatever became of the previous one. */
  begin(start: GestureStart): void;
  /** Escape: the gesture to put back, or null when none of ours is running. */
  cancel(): GestureStart | null;
  /** `dragend`: true — dispatch the command; false — the gesture was cancelled. */
  finish(): boolean;
  /** The gesture in progress; null outside one. */
  readonly started: GestureStart | null;
};

export function createGestureGuard(): GestureGuard {
  let started: GestureStart | null = null;
  let cancelled = false;

  return {
    begin(start: GestureStart): void {
      started = start;
      cancelled = false;
    },
    cancel(): GestureStart | null {
      // A resize handle opens its gesture at `pointerdown`, because the grab
      // offset has to be read before Konva's drag threshold is passed. A press
      // that never became a drag leaves that gesture open, and Escape then
      // belongs to the canvas, not to us: cancelling it would snap the handle
      // back to a screen position the viewport may have long moved away from.
      if (started === null || !started.node.isDragging()) return null;
      const gesture = started;
      started = null;
      cancelled = true;
      return gesture;
    },
    finish(): boolean {
      const committed = !cancelled;
      started = null;
      cancelled = false;
      return committed;
    },
    get started(): GestureStart | null {
      return started;
    },
  };
}
