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
import { contains, isSimplePolygon } from '../../domain/geometry';
import { zoneDepth } from '../../domain/relations';

const SNAP_M = 0.01;

/** Pointer capture radius of a handle on screen, in pixels. */
export const HANDLE_RADIUS_PX = 8;

export function snapPoint(point: Point): Point {
  return [Math.round(point[0] / SNAP_M) * SNAP_M, Math.round(point[1] / SNAP_M) * SNAP_M];
}

export function moveVertex(polygon: Polygon, index: number, point: Point): Polygon {
  const snapped = snapPoint(point);
  return polygon.map((vertex, at) => (at === index ? snapped : vertex));
}

/** Inserts after edge `index`, i.e. between vertex `index` and the next one. */
export function insertVertex(polygon: Polygon, index: number, point: Point): Polygon {
  const next = polygon.slice();
  next.splice(index + 1, 0, snapPoint(point));
  return next;
}

/** A ring keeps at least three vertices; below that there is nothing to edit. */
export function removeVertex(polygon: Polygon, index: number): Polygon | null {
  if (polygon.length <= 3) return null;
  if (index < 0 || index >= polygon.length) return null;
  return polygon.filter((_, at) => at !== index);
}

export type EdgeHit = { index: number; point: Point; distance: number };

function projectOnSegment(point: Point, from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return from;
  const t = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  return [from[0] + dx * clamped, from[1] + dy * clamped];
}

/** Closest edge of the ring to a point, with the foot of the perpendicular. */
export function nearestEdge(polygon: Polygon, point: Point): EdgeHit {
  let best: EdgeHit = { index: 0, point: polygon[0] ?? point, distance: Infinity };
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index]!;
    const to = polygon[(index + 1) % polygon.length]!;
    const foot = projectOnSegment(point, from, to);
    const distance = Math.hypot(point[0] - foot[0], point[1] - foot[1]);
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
 * middle half of every edge inserts (D-101).
 */
export function insertionOnEdge(polygon: Polygon, point: Point): EdgeHit | null {
  const hit = nearestEdge(polygon, point);
  const from = polygon[hit.index];
  const to = polygon[(hit.index + 1) % polygon.length];
  if (from === undefined || to === undefined) return null;

  const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const away = (target: Point): number => Math.hypot(point[0] - target[0], point[1] - target[1]);
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

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
}

export function moveWallEnd(wall: Wall, end: 'from' | 'to', point: Point): Wall {
  return { ...wall, [end]: snapPoint(point) };
}

/**
 * Puts the opening's centre under the pointer and keeps the whole opening on
 * the wall: `offset_m` stays within [0, length − width]. A wall shorter than
 * the opening leaves it at the `from` end — validation will say the rest.
 */
export function moveOpeningTo(opening: Opening, wall: Wall, point: Point): Opening {
  const length = wallLength(wall);
  if (length === 0) return { ...opening, offset_m: 0 };
  const foot = projectOnSegment(point, wall.from, wall.to);
  const along = Math.hypot(foot[0] - wall.from[0], foot[1] - wall.from[1]);
  const maxOffset = Math.max(0, length - opening.width_m);
  const offset = Math.min(maxOffset, Math.max(0, along - opening.width_m / 2));
  return { ...opening, offset_m: Math.round(offset / SNAP_M) * SNAP_M };
}

/**
 * A zone drawn inside another zone is nested in it: the deepest zone whose
 * polygon contains the whole ring becomes the parent. A ring crossing a
 * border or lying outside every zone stands on its own.
 */
export function parentForRing(ring: Polygon, zones: Zone[]): Id | null {
  let best: { id: Id; depth: number } | null = null;
  for (const zone of zones) {
    if (!isSimplePolygon(zone.polygon) || !contains(zone.polygon, ring)) continue;
    const depth = zoneDepth(zone.id, zones) ?? 0;
    if (best === null || depth > best.depth) best = { id: zone.id, depth };
  }
  return best?.id ?? null;
}
