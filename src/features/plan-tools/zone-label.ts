/**
 * Where a zone's name sits on the plan (UI-2А, D-216).
 *
 * The geometric middle of a zone is also where a designer puts a bench, a
 * rack row or a kiosk — the common case, not the exception. A name glued to
 * the centroid then fights the object's own caption for the same pixels. The
 * rule stays simple and deterministic: the centre, unless an object's
 * footprint reaches it, in which case the name settles just clear of every
 * footprint blocking that row — above them or below, whichever is the
 * shorter move — rather than jumping to a fixed corner that might sit on a
 * *different* object instead.
 *
 * Pure geometry only: no Konva, no catalog, no React — a caller supplies the
 * zone polygon and the footprints already in its way.
 */

import type { Point, Polygon } from '../../contracts/model';
import { type BoundingBox, boundingBox } from '../../domain/geometry';

/**
 * Footprint reserved for the caption, in metres. Fixed rather than measured
 * from the rendered text: the anchor is decided once per render pass, before
 * Konva has laid out any glyphs. Close to the actual rendered height of a
 * zone name (`ZONE_LABEL_FONT_PX` in `PlanGeometryLayer.tsx`) plus a little
 * air — generous enough to catch a real clash, tight enough that two objects
 * a hand's width apart still leave a gap the name can sit in.
 */
const RESERVED_WIDTH_M = 3;
const RESERVED_HEIGHT_M = 0.5;
const HALF_HEIGHT_M = RESERVED_HEIGHT_M / 2;

/** Clearance left between the name and the footprint it stepped around. */
const GAP_M = 0.12;

/**
 * Clearance from the zone's own boundary when the name has nowhere clear to
 * go: a wall is typically drawn right along that boundary (`wallPolygon` in
 * `PlanGeometryLayer.tsx`, painted after the labels), and a name pushed flush
 * against the edge ends up hidden under it rather than merely close to an
 * object — worse than the clash it was trying to avoid.
 */
const EDGE_CLEARANCE_M = 0.2;

type Interval = { min: number; max: number };

/** Merges overlapping (or touching) ranges so escaping one clears all of them. */
function mergeIntervals(ranges: Interval[]): Interval[] {
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  const merged: Interval[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.min <= last.max) {
      last.max = Math.max(last.max, range.max);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Anchor for a zone's name: the midpoint of its extent, or — when an
 * object's footprint reaches that midpoint — a point immediately clear of
 * every footprint sharing that row. `objectBoxes` are the footprints already
 * competing for space (any object on the plan reaching near the zone is
 * enough; the caller does not have to filter by zone membership first).
 *
 * The move is vertical only and picks whichever side needs the shorter push,
 * clamped so the name never leaves the zone's own extent. A zone packed
 * tightly enough that no row is fully clear (several objects within a
 * couple of metres of each other) settles on the side with the most room —
 * still an improvement over sitting on the object, though not guaranteed
 * clear; that is a known limit of a simple, one-pass rule.
 */
export function zoneLabelAnchor(polygon: Polygon, objectBoxes: readonly BoundingBox[]): Point {
  const box = boundingBox(polygon);
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;

  const reservedMinX = centreX - RESERVED_WIDTH_M / 2;
  const reservedMaxX = centreX + RESERVED_WIDTH_M / 2;
  // "Above" the footprint means a greater Y, not a smaller one: the model's Y
  // axis points up (`coordinates.ts`), so a larger Y sits higher on screen —
  // the forbidden range below already folds that in, `min`/`max` are just
  // the model's own Y order.
  const forbidden = mergeIntervals(
    objectBoxes
      .filter((object) => object.minX < reservedMaxX && reservedMinX < object.maxX)
      .map((object) => ({
        min: object.minY - GAP_M - HALF_HEIGHT_M,
        max: object.maxY + GAP_M + HALF_HEIGHT_M,
      })),
  );

  const blocking = forbidden.find((range) => centreY >= range.min && centreY <= range.max);
  if (blocking === undefined) return [centreX, centreY];

  // The tight bound keeps the reserved box inside the zone at all; the wider
  // one also keeps it off the boundary itself. A zone shallow enough that the
  // wider bound would invert falls back to the tight one — still inside the
  // zone, just without the extra margin it has no room for.
  const tightLow = Math.min(box.minY + HALF_HEIGHT_M, box.maxY - HALF_HEIGHT_M);
  const tightHigh = Math.max(box.minY + HALF_HEIGHT_M, box.maxY - HALF_HEIGHT_M);
  const wideLow = box.minY + HALF_HEIGHT_M + EDGE_CLEARANCE_M;
  const wideHigh = box.maxY - HALF_HEIGHT_M - EDGE_CLEARANCE_M;
  const low = wideLow <= wideHigh ? wideLow : tightLow;
  const high = wideLow <= wideHigh ? wideHigh : tightHigh;
  const aboveFits = blocking.max <= high;
  const belowFits = blocking.min >= low;

  let y: number;
  if (aboveFits && belowFits) {
    y = Math.abs(blocking.max - centreY) <= Math.abs(blocking.min - centreY) ? blocking.max : blocking.min;
  } else if (aboveFits) {
    y = blocking.max;
  } else if (belowFits) {
    y = blocking.min;
  } else {
    // Blocked the whole way in both directions: settle toward whichever end
    // of the zone had more room to begin with.
    y = centreY - low <= high - centreY ? high : low;
  }
  return [centreX, Math.min(Math.max(y, low), high)];
}
