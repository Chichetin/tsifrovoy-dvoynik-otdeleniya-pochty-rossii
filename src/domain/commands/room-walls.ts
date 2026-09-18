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
 * the opening keeps its relative position along the edge, so widening a room
 * does not push the entrance off its wall. An opening on an edge that no longer
 * exists is dropped together with the wall — there is nothing to hang it on.
 */

import type { Id, Opening, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';

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
): RebuiltWalls {
  const outer = walls.filter((wall) => edgeIndexOf(wall, oldBoundary) !== null);
  const partitions = walls.filter((wall) => edgeIndexOf(wall, oldBoundary) === null);
  const partitionIds = new Set(partitions.map((wall) => wall.id));

  const template = outer[0] ?? fallback;
  const taken = new Set<Id>(partitionIds);
  const rebuilt: Wall[] = [];
  const idByEdge = new Map<number, Id>();

  newBoundary.forEach((from, index) => {
    const to = newBoundary[(index + 1) % newBoundary.length];
    if (to === undefined) return;
    const id = nextId('w_', taken);
    taken.add(id);
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
 */
function edgeIndexOf(wall: Wall, boundary: Polygon): number | null {
  for (let index = 0; index < boundary.length; index += 1) {
    const a = boundary[index];
    const b = boundary[(index + 1) % boundary.length];
    if (a === undefined || b === undefined) continue;
    if (onSegment(wall.from, a, b) && onSegment(wall.to, a, b)) return index;
  }
  return null;
}

function onSegment(point: Point, a: Point, b: Point): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= TOLERANCE.coordinate_m) return false;
  const cross = Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
  if (cross > 1e-6) return false;
  const along = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (length * length);
  return along >= -1e-9 && along <= 1 + 1e-9;
}

/**
 * The same edge of the new boundary, if the corner it starts from is still
 * there: an edge is matched by its start vertex, which is how a person sees a
 * dragged corner — "the north wall moved", not "a new wall appeared".
 */
function carryOpening(
  opening: Opening,
  wall: Wall,
  oldBoundary: Polygon,
  newBoundary: Polygon,
  edge: number,
  idByEdge: Map<number, Id>,
): Opening | null {
  // An edge the new boundary no longer has yields no vertex below, and the
  // opening is dropped with its wall.
  const targetId = idByEdge.get(edge);
  const a = newBoundary[edge];
  const b = newBoundary[(edge + 1) % newBoundary.length];
  const oldA = oldBoundary[edge];
  const oldB = oldBoundary[(edge + 1) % oldBoundary.length];
  if (targetId === undefined || a === undefined || b === undefined || oldA === undefined || oldB === undefined) {
    return null;
  }

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

function nextId(prefix: string, taken: Set<Id>): Id {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}
