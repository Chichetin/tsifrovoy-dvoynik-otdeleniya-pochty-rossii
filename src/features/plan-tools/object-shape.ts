/**
 * Object shape editing (D-279), pure part: a ring the person shaped on the
 * plan, in world metres, back into an object's `size_m`, `position` and
 * `outline` (D-277).
 *
 * The layer edits the world footprint with the same vertex functions as a
 * zone (`vertex-edit.ts`); this file only folds the result back: the ring is
 * turned into the object's own frame, its box becomes the new `size_m`, the
 * box centre the new `position`, and the vertices fractions of that box — so
 * the outline spans exactly [-0.5, 0.5] again and nothing on the plan moves.
 */

import type { Equipment, Point, Polygon } from '../../contracts/model';
import { normalizeOutline } from '../../contracts/outline';
import { isSimplePolygon, rotateOffset, toWorld } from '../../domain/geometry';

/** Shortest side a shaped object may have — the same floor as a resize by handle. */
export const MIN_SHAPE_SIDE_M = 0.1;

/** To the millimetre: the box is the shape's own, a centimetre would visibly shift a vertex. */
function mm(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

export type ShapeRefusal = 'self-intersection' | 'too-small';

export type ShapeResult = { ok: true; object: Equipment } | { ok: false; reason: ShapeRefusal };

/**
 * The object whose footprint is `ring` (world metres), keeping its rotation
 * and everything else. A crossed ring or one flatter than `MIN_SHAPE_SIDE_M`
 * is refused: the first is not a floor shape, the second has no box to
 * express it in.
 */
export function reshapeObject(object: Equipment, ring: Polygon): ShapeResult {
  if (ring.length < 3 || !isSimplePolygon(ring)) return { ok: false, reason: 'self-intersection' };
  // Into the object's frame: the inverse of `toWorld` about the current centre.
  const local = ring.map(([x, y]): Point =>
    rotateOffset([x - object.position[0], y - object.position[1]], -object.rotation_deg),
  );
  const xs = local.map((point) => point[0]);
  const ys = local.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = mm(maxX - minX);
  const depth = mm(maxY - minY);
  if (width < MIN_SHAPE_SIDE_M || depth < MIN_SHAPE_SIDE_M) return { ok: false, reason: 'too-small' };
  const centre = toWorld(object.position, [(minX + maxX) / 2, (minY + maxY) / 2], object.rotation_deg);
  return {
    ok: true,
    object: {
      ...object,
      position: [mm(centre[0]), mm(centre[1])],
      size_m: [width, depth],
      outline: normalizeOutline(local),
    },
  };
}

/**
 * A freshly drawn ring as the shape of a new object: unrotated, centred on the
 * ring's box, the box as `size_m`. Everything else — id, type, height, layer,
 * attributes — comes from `base`, which the caller builds like a library
 * placement would.
 */
export function objectFromRing(base: Equipment, ring: Polygon): ShapeResult {
  return reshapeObject({ ...base, position: ring[0] ?? base.position, rotation_deg: 0 }, ring);
}
