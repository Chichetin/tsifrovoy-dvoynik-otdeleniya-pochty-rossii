/**
 * U04: the arithmetic behind rotate and resize gestures.
 *
 * Pure functions over world metres. The layer converts the pointer through
 * src/domain/geometry once and hands the result here, so nothing in this file
 * knows about pixels, zoom or the Y flip — a gesture that is right at one zoom
 * level is right at every other.
 *
 * Conventions follow D-010: `position` is the centre, `size_m` is the local
 * extent before rotation, a positive angle turns clockwise, and at 0° the
 * object faces local +Y. The rotation handle sits in front of the object, so
 * dragging it points the object where the pointer is.
 */

import type { Equipment, Point } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { normalizeAngle, rotateOffset, toWorld } from '../../domain/geometry';

/** Smallest side a resize can leave; 10 cm is the thinnest thing in the catalog. */
export const MIN_SIZE_M = 0.1;

/** Shift snaps the angle to multiples of this. */
export const ROTATION_SNAP_DEG = 15;

/** Gestures write centimetres and tenths of a degree — enough for a plan, readable in JSON. */
const POSITION_UNITS_PER_M = 100;
const ROTATION_UNITS_PER_DEG = 10;

export type HandleId = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** `sx`/`sy` say which local sides the handle moves: 0 keeps that axis as is. */
export type ResizeHandle = { id: HandleId; sx: -1 | 0 | 1; sy: -1 | 0 | 1 };

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  { id: 'n', sx: 0, sy: 1 },
  { id: 'ne', sx: 1, sy: 1 },
  { id: 'e', sx: 1, sy: 0 },
  { id: 'se', sx: 1, sy: -1 },
  { id: 's', sx: 0, sy: -1 },
  { id: 'sw', sx: -1, sy: -1 },
  { id: 'w', sx: -1, sy: 0 },
  { id: 'nw', sx: -1, sy: 1 },
];

/** Rounds to 1/`units`; multiplying by an integer keeps 5.56 from becoming 5.5600000000000005. */
function roundTo(value: number, units: number): number {
  // `|| 0` turns -0 into 0 so a rounded value never prints as "-0".
  return Math.round(value * units) / units || 0;
}

/** World point of a resize handle on the object's rotated outline. */
export function handlePoint(object: Equipment, handle: ResizeHandle): Point {
  const [width, height] = object.size_m;
  return toWorld(
    object.position,
    [(handle.sx * width) / 2, (handle.sy * height) / 2],
    object.rotation_deg,
  );
}

/** World point of the rotation handle: `gap_m` in front of the object's front edge. */
export function rotationHandlePoint(object: Equipment, gap_m: number): Point {
  return toWorld(object.position, [0, object.size_m[1] / 2 + gap_m], object.rotation_deg);
}

/**
 * Angle that points the object's front at the pointer. Free rotation is kept
 * to a tenth of a degree; Shift snaps to `ROTATION_SNAP_DEG`. A pointer sitting
 * on the centre has no direction, so the current angle stays.
 */
export function rotationFromPointer(
  centre: Point,
  pointer: Point,
  shift: boolean,
  current_deg: number,
): number {
  const dx = pointer[0] - centre[0];
  const dy = pointer[1] - centre[1];
  if (Math.hypot(dx, dy) <= TOLERANCE.coordinate_m) return normalizeAngle(current_deg);

  // Local +Y rotated clockwise by θ lands at (sin θ, cos θ).
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI;
  const snapped = shift
    ? Math.round(degrees / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG
    : roundTo(degrees, ROTATION_UNITS_PER_DEG);
  // Snapping -3° gives -0, which normalises to -0; `|| 0` keeps "0" in the card.
  return normalizeAngle(snapped) || 0;
}

/**
 * New centre and size when `handle` is dragged to `pointer`. The opposite side
 * (or corner) stays where it is, like every drawing tool the jury has used;
 * a side is never shorter than `MIN_SIZE_M`, so the object cannot flip.
 */
export function resizeFromPointer(
  object: Equipment,
  handle: ResizeHandle,
  pointer: Point,
): { position: Point; size_m: Point } {
  const [width, height] = object.size_m;
  // Pointer in the object's own axes: undo the clockwise rotation.
  const [lx, ly] = rotateOffset(
    [pointer[0] - object.position[0], pointer[1] - object.position[1]],
    -object.rotation_deg,
  );

  const extent = (sign: number, local: number, size: number): number =>
    sign === 0 ? size : Math.max(MIN_SIZE_M, sign * local + size / 2);
  const nextWidth = roundTo(extent(handle.sx, lx, width), POSITION_UNITS_PER_M);
  const nextHeight = roundTo(extent(handle.sy, ly, height), POSITION_UNITS_PER_M);

  // The anchored side sits at -sign * size / 2; the new centre is half the new size from it.
  const centreX = (handle.sx * (nextWidth - width)) / 2;
  const centreY = (handle.sy * (nextHeight - height)) / 2;
  const position = toWorld(object.position, [centreX, centreY], object.rotation_deg);

  return {
    position: snapPosition(position),
    size_m: [nextWidth, nextHeight],
  };
}

/** Rounds a dragged position to the centimetre. */
export function snapPosition(point: Point): Point {
  return [roundTo(point[0], POSITION_UNITS_PER_M), roundTo(point[1], POSITION_UNITS_PER_M)];
}
