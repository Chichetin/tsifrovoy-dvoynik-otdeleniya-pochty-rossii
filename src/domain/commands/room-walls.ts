/**
 * Outer walls follow the room outline.
 *
 * The model has no "outer" flag on a wall, and the contract is frozen. An outer
 * wall is recognised by geometry instead: its segment lies on an edge of the
 * room boundary. That is enough to tell it from a partition, and it is what a
 * person means by "the wall of the room".
 *
 * When the outline changes, outer walls are rebuilt edge by edge and partitions
 * are left alone. Openings on an outer wall survive when their edge survives:
 * the edge is found again by its corners, not by its number, so inserting a
 * vertex elsewhere in the outline does not move the entrance; the opening keeps
 * its relative position along the edge, so widening a room does not push the
 * entrance off its wall. An opening on an edge that no longer exists is dropped
 * together with the wall — there is nothing to hang it on.
 */

import type { Id, Opening, Point, Polygon, Wall } from '../../contracts/model';
import { nextFreeId } from './ids';
import { TOLERANCE } from '../../contracts/model';
import { pointSegmentDistance, segmentLength } from '../geometry';

/** Which walls of the plan are outer, i.e. sit on the current boundary. */
export function outerWallIds(walls: Wall[], boundary: Polygon): Set<Id> {
  const outer = new Set<Id>();
  for (const wall of walls) {
    if (edgeIndexOf(wall, boundary) !== null) outer.add(wall.id);
  }
  return outer;
}

export type RebuiltWalls = { walls: Wall[]; openings: Opening[] };

/**
 * Walls and openings for a new boundary. Partitions keep their ids; outer walls
 * get ids `w_1`, `w_2`, … that are free in the plan; openings keep their ids.
 * Defaults for a brand-new outer wall come from the outer walls being replaced,
 * or from `fallback` when the plan had none.
 */
export function rebuildOuterWalls(
  walls: Wall[],
  openings: Opening[],
  oldBoundary: Polygon,
  newBoundary: Polygon,
  fallback: { thickness_m: number; height_m: number },
  reservedIds: Iterable<Id> = [],
): RebuiltWalls {
  const outer = walls.filter((wall) => edgeIndexOf(wall, oldBoundary) !== null);
  const partitions = walls.filter((wall) => edgeIndexOf(wall, oldBoundary) === null);
  const partitionIds = new Set(partitions.map((wall) => wall.id));

  const template = outer[0] ?? fallback;
  const taken = new Set<Id>([...partitionIds, ...reservedIds]);
  const rebuilt: Wall[] = [];
  const idByEdge = new Map<number, Id>();

  newBoundary.forEach((from, index) => {
    const to = newBoundary[(index + 1) % newBoundary.length];
    if (to === undefined) return;
    const id = nextFreeId('w_', taken);
    idByEdge.set(index, id);
    rebuilt.push({
      id,
      from: [from[0], from[1]],
      to: [to[0], to[1]],
      thickness_m: template.thickness_m,
      height_m: template.height_m,
    });
  });

  // Openings: partition openings untouched; outer openings follow their edge.
  const kept: Opening[] = [];
  const outerById = new Map(outer.map((wall) => [wall.id, wall]));
  for (const opening of openings) {
    if (partitionIds.has(opening.wallId)) {
      kept.push(opening);
      continue;
    }
    const wall = outerById.get(opening.wallId);
    if (wall === undefined) continue;
    const edge = edgeIndexOf(wall, oldBoundary);
    if (edge === null) continue;

    const moved = carryOpening(opening, wall, oldBoundary, newBoundary, edge, idByEdge);
    if (moved !== null) kept.push(moved);
  }

  return { walls: [...partitions, ...rebuilt], openings: kept };
}

/**
 * Index of the boundary edge this wall lies on, or null for a partition. Both
 * ends must sit on the edge's line within tolerance and inside its extent —
 * a wall that runs along an edge but sticks out past a corner is not that edge.
 *
 * A wall that spans several collinear edges (a plan saved with a vertex
 * inserted into a straight wall before walls followed the outline) is outer
 * too: its ends lie on the boundary and every point between them does. It is
 * attributed to the edge its `from` end sits on.
 */
function edgeIndexOf(wall: Wall, boundary: Polygon): number | null {
  const count = boundary.length;
  const edge = (index: number): [Point, Point] | null => {
    const a = boundary[index];
    const b = boundary[(index + 1) % count];
    return a === undefined || b === undefined ? null : [a, b];
  };

  for (let index = 0; index < count; index += 1) {
    const pair = edge(index);
    if (pair === null) continue;
    if (onSegment(wall.from, pair[0], pair[1]) && onSegment(wall.to, pair[0], pair[1])) return index;
  }

  // Spanning run: from `from` walk forward along collinear edges until `to`.
  for (let start = 0; start < count; start += 1) {
    const first = edge(start);
    if (first === null || !onSegment(wall.from, first[0], first[1])) continue;
    for (let step = 1; step < count; step += 1) {
      const next = edge((start + step) % count);
      if (next === null || !collinear(first[0], first[1], next[1])) break;
      if (onSegment(wall.to, next[0], next[1])) return start;
    }
  }
  return null;
}

function collinear(a: Point, b: Point, c: Point): boolean {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(cross) <= 1e-6 * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
}

function onSegment(point: Point, a: Point, b: Point): boolean {
  if (segmentLength(a, b) <= TOLERANCE.coordinate_m) return false;
  // The one projection primitive (D-199): within a coordinate tolerance of the
  // clamped foot — beside the segment or past an end both count as "off".
  return pointSegmentDistance(point, a, b) <= TOLERANCE.coordinate_m;
}

/**
 * Which edge of the new boundary is "the same wall" as an old edge. Matched by
 * geometry, not by index: inserting or deleting a vertex shifts every index
 * after it, and an index match would move the entrance onto a wall the user
 * never touched. A wall whose both corners are still in place is the same wall.
 * With a corner dragged (vertex count unchanged) the other corner identifies it;
 * after an insertion or deletion a single shared corner is ambiguous — the
 * neighbouring edge shares it too — so only a full match counts there.
 */
function matchEdge(
  oldA: Point,
  oldB: Point,
  oldIndex: number,
  oldCount: number,
  newBoundary: Polygon,
): number | null {
  const count = newBoundary.length;
  const same = (p: Point | undefined, q: Point): boolean =>
    p !== undefined && Math.hypot(p[0] - q[0], p[1] - q[1]) <= TOLERANCE.coordinate_m;
  const startOf = (index: number): Point | undefined => newBoundary[index];
  const endOf = (index: number): Point | undefined => newBoundary[(index + 1) % count];

  // Both corners still there: the same wall, wherever it is in the list.
  for (let index = 0; index < count; index += 1) {
    if (same(startOf(index), oldA) && same(endOf(index), oldB)) return index;
  }

  // One corner dragged. Only when the vertex count is unchanged can a single
  // shared corner mean "this wall moved": after an insertion or deletion the
  // neighbouring edge shares that corner too, and it is a different wall.
  if (count !== oldCount) return null;
  for (let index = 0; index < count; index += 1) {
    if (same(startOf(index), oldA)) return index;
  }
  for (let index = 0; index < count; index += 1) {
    if (same(endOf(index), oldB)) return index;
  }
  return oldIndex < count ? oldIndex : null;
}

/** The opening carried onto the matched edge, or null when it cannot fit. */
function carryOpening(
  opening: Opening,
  wall: Wall,
  oldBoundary: Polygon,
  newBoundary: Polygon,
  edge: number,
  idByEdge: Map<number, Id>,
): Opening | null {
  const oldA = oldBoundary[edge];
  const oldB = oldBoundary[(edge + 1) % oldBoundary.length];
  if (oldA === undefined || oldB === undefined) return null;

  // No matching edge — the wall is gone, and the opening goes with it.
  const target = matchEdge(oldA, oldB, edge, oldBoundary.length, newBoundary);
  if (target === null) return null;
  const targetId = idByEdge.get(target);
  const a = newBoundary[target];
  const b = newBoundary[(target + 1) % newBoundary.length];
  if (targetId === undefined || a === undefined || b === undefined) return null;

  // Relative position along the old edge, measured from the wall's own `from`
  // end and re-expressed from the new edge's start vertex.
  const oldLength = Math.hypot(oldB[0] - oldA[0], oldB[1] - oldA[1]);
  const newLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (oldLength <= TOLERANCE.coordinate_m || newLength <= TOLERANCE.coordinate_m) return null;

  const wallStartAlong = Math.hypot(wall.from[0] - oldA[0], wall.from[1] - oldA[1]);
  const forward =
    (wall.to[0] - wall.from[0]) * (oldB[0] - oldA[0]) + (wall.to[1] - wall.from[1]) * (oldB[1] - oldA[1]) >= 0;
  const centreOld = forward
    ? wallStartAlong + opening.offset_m + opening.width_m / 2
    : wallStartAlong - opening.offset_m - opening.width_m / 2;
  const fraction = Math.min(1, Math.max(0, centreOld / oldLength));

  const centreNew = fraction * newLength;
  const offset = Math.min(Math.max(0, centreNew - opening.width_m / 2), Math.max(0, newLength - opening.width_m));
  if (newLength < opening.width_m) return null;

  return { ...opening, wallId: targetId, offset_m: Math.round(offset * 100) / 100 };
}

