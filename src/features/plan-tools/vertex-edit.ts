/**
 * U03 (pure part): what a vertex, wall-end or opening gesture does to the
 * model. No React, no Konva — the layer translates pointer positions into
 * world points and asks these functions for the resulting entity, then sends
 * one command per finished gesture.
 *
 * Coordinates are snapped to a centimetre: a plan file full of
 * 3.4166666667 is unreadable, and nothing in the branch is placed finer.
 */

import type { Id, Opening, Point, Polygon, Wall, Zone } from '../../contracts/model';
import { isSimplePolygon, projectOnSegment, segmentLength, wallLength } from '../../domain/geometry';
import { parentZoneFor } from '../../domain/relations';

/** Centimetres per metre: vertices are stored to the centimetre. */
const CM_PER_M = 100;

/** Pointer capture radius of a handle on screen, in pixels. */
export const HANDLE_RADIUS_PX = 8;

/**
 * To the centimetre. Multiply then divide, not multiply by 0.01: dividing by
 * 100 gives the nearest double to the decimal (2.3), where `230 * 0.01` gives
 * 2.3000000000000003 — and the file is read by people (operator №17).
 */
export function roundPoint(point: Point): Point {
  return [Math.round(point[0] * CM_PER_M) / CM_PER_M, Math.round(point[1] * CM_PER_M) / CM_PER_M];
}

/** The point arrives settled by the layer (snapped or rounded) and is stored as given. */
export function moveVertex(polygon: Polygon, index: number, point: Point): Polygon {
  return polygon.map((vertex, at) => (at === index ? point : vertex));
}

/** Inserts after edge `index`, i.e. between vertex `index` and the next one. */
export function insertVertex(polygon: Polygon, index: number, point: Point): Polygon {
  const next = polygon.slice();
  next.splice(index + 1, 0, roundPoint(point));
  return next;
}

/** A ring keeps at least three vertices; below that there is nothing to edit. */
export function removeVertex(polygon: Polygon, index: number): Polygon | null {
  if (polygon.length <= 3) return null;
  if (index < 0 || index >= polygon.length) return null;
  return polygon.filter((_, at) => at !== index);
}

export type EdgeHit = { index: number; point: Point; distance: number };

/** Closest edge of the ring to a point, with the foot of the perpendicular. */
export function nearestEdge(polygon: Polygon, point: Point): EdgeHit {
  let best: EdgeHit = { index: 0, point: polygon[0] ?? point, distance: Infinity };
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index]!;
    const to = polygon[(index + 1) % polygon.length]!;
    const { foot, distance } = projectOnSegment(point, from, to);
    if (distance < best.distance) best = { index, point: foot, distance };
  }
  return best;
}

/**
 * Where a click on the ring's outline adds a vertex, or null when the click
 * belongs to a corner rather than to an edge.
 *
 * The edge has a wide capture strip so that it can be hit at all, and near a
 * vertex that strip overlaps the neighbouring edge and the vertex handle
 * itself. A click closer to an end of the edge than to its middle was aimed at
 * the corner, and adding a vertex there is never what the user wanted; the
 * middle half of every edge inserts (D-099).
 */
export function insertionOnEdge(polygon: Polygon, point: Point): EdgeHit | null {
  const hit = nearestEdge(polygon, point);
  const from = polygon[hit.index];
  const to = polygon[(hit.index + 1) % polygon.length];
  if (from === undefined || to === undefined) return null;

  const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const away = (target: Point): number => segmentLength(point, target);
  const toVertex = Math.min(away(from), away(to));
  return toVertex < away(middle) ? null : hit;
}

/**
 * The store accepts a self-intersecting ring as a diagnosable state (S01);
 * a gesture is where it is cheapest to refuse one, before it is committed.
 */
export function canCommitRing(polygon: Polygon): boolean {
  return isSimplePolygon(polygon);
}

/** As `moveVertex`: the end is stored as the layer settled it. */
export function moveWallEnd(wall: Wall, end: 'from' | 'to', point: Point): Wall {
  return { ...wall, [end]: point };
}

/**
 * Puts the opening's centre under the pointer and keeps the whole opening on
 * the wall: `offset_m` stays within [0, length − width]. A wall shorter than
 * the opening leaves it at the `from` end — validation will say the rest.
 */
export function moveOpeningTo(opening: Opening, wall: Wall, point: Point): Opening {
  const length = wallLength(wall);
  if (length === 0) return { ...opening, offset_m: 0 };
  const along = projectOnSegment(point, wall.from, wall.to).t * length;
  const maxOffset = Math.max(0, length - opening.width_m);
  const offset = Math.min(maxOffset, Math.max(0, along - opening.width_m / 2));
  return { ...opening, offset_m: Math.round(offset * CM_PER_M) / CM_PER_M };
}

/** Nesting of a freshly drawn ring — the one rule from `domain/relations` (D-199). */
export function parentForRing(ring: Polygon, zones: Zone[]): Id | null {
  return parentZoneFor(ring, zones);
}
