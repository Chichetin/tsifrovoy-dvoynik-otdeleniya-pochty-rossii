/**
 * G01: public geometry interface. Consumers import from here and never reach
 * into polygons.ts or coordinates.ts.
 *
 * This module knows nothing about the catalog: whether an object is `physical`
 * or `occupiesFloor` is a catalog question, so the caller applies those flags.
 * Geometry only answers where things are and whether they overlap.
 */

import type { Equipment, Opening, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { toWorld } from './coordinates';
import {
  boundingBox,
  boxesOverlap,
  polygonArea,
  polygonContains,
  polygonsOverlap,
  rectangleCorners,
} from './polygons';

export {
  degToRad,
  modelToScreen,
  normalizeAngle,
  rotateOffset,
  screenToModel,
  toWorld,
} from './coordinates';
export {
  boundingBox,
  boxesOverlap,
  locatePoint,
  isSimplePolygon,
  polygonArea,
  segmentsProperlyCross,
  signedArea,
  type BoundingBox,
  type PointPosition,
} from './polygons';

/** Vertical span an object occupies, from the floor. */
export type HeightInterval = { base_m: number; top_m: number };

export function objectInterval(object: Equipment): HeightInterval {
  return { base_m: object.base_m, top_m: object.base_m + object.height_m };
}

/** Positive overlap only: a shelf standing exactly on a plinth does not collide. */
export function intervalsOverlap(a: HeightInterval, b: HeightInterval): boolean {
  const low = Math.max(a.base_m, b.base_m);
  const high = Math.min(a.top_m, b.top_m);
  return high - low > TOLERANCE.coordinate_m;
}

/** Floor projection of a rotated object, as a world polygon. */
export function footprint(object: Equipment): Polygon {
  const local = rectangleCorners([0, 0], object.size_m);
  return local.map((corner) => toWorld(object.position, corner, object.rotation_deg));
}

export function contains(container: Polygon, shape: Polygon): boolean {
  return polygonContains(container, shape);
}

export function intersects(a: Polygon, b: Polygon): boolean {
  return polygonsOverlap(a, b);
}

/**
 * Two objects share space only when they overlap both on the floor and in
 * height. A camera on the wall above a rack is not a collision; the caller
 * still decides whether both objects are physical.
 */
export function objectsShareSpace(a: Equipment, b: Equipment): boolean {
  if (!intervalsOverlap(objectInterval(a), objectInterval(b))) return false;
  return polygonsOverlap(footprint(a), footprint(b));
}

/** The wall as a rectangle of its own thickness. */
export function wallPolygon(wall: Wall): Polygon {
  const [fx, fy] = wall.from;
  const [tx, ty] = wall.to;
  const length = Math.hypot(tx - fx, ty - fy);
  if (length <= TOLERANCE.coordinate_m) return [];
  return wallSpanPolygon(wall, 0, length);
}

function wallSpanPolygon(wall: Wall, start: number, end: number): Polygon {
  const [fx, fy] = wall.from;
  const [tx, ty] = wall.to;
  const length = Math.hypot(tx - fx, ty - fy);
  const ux = (tx - fx) / length;
  const uy = (ty - fy) / length;
  const half = wall.thickness_m / 2;
  const nx = -uy * half;
  const ny = ux * half;
  const a: Point = [fx + ux * start + nx, fy + uy * start + ny];
  const b: Point = [fx + ux * end + nx, fy + uy * end + ny];
  const c: Point = [fx + ux * end - nx, fy + uy * end - ny];
  const d: Point = [fx + ux * start - nx, fy + uy * start - ny];
  return [a, b, c, d];
}

/**
 * Solid parts of a wall for a given height band. An opening clears its span
 * only when it covers the whole band: a desk in front of a window still meets
 * solid wall below the sill, while a doorway from floor to lintel does not.
 */
export function wallObstacles(
  wall: Wall,
  openings: Opening[],
  interval: HeightInterval,
): Polygon[] {
  const overlap = { base_m: Math.max(0, interval.base_m), top_m: Math.min(wall.height_m, interval.top_m) };
  if (!intervalsOverlap({ base_m: 0, top_m: wall.height_m }, interval)) return [];
  const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
  if (length <= TOLERANCE.coordinate_m) return [];

  const gaps = openings
    .filter((opening) => opening.wallId === wall.id)
    .filter(
      (opening) =>
        opening.sill_m <= overlap.base_m + TOLERANCE.coordinate_m &&
        opening.sill_m + opening.height_m >= overlap.top_m - TOLERANCE.coordinate_m,
    )
    .map((opening) => ({
      start: Math.max(0, opening.offset_m),
      end: Math.min(length, opening.offset_m + opening.width_m),
    }))
    .filter((gap) => gap.end - gap.start > TOLERANCE.coordinate_m)
    .sort((left, right) => left.start - right.start);

  const parts: Polygon[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.start - cursor > TOLERANCE.coordinate_m) {
      parts.push(wallSpanPolygon(wall, cursor, gap.start));
    }
    cursor = Math.max(cursor, gap.end);
  }
  if (length - cursor > TOLERANCE.coordinate_m) {
    parts.push(wallSpanPolygon(wall, cursor, length));
  }
  return parts;
}

/** Does an object run into a wall, openings at its height taken into account? */
export function objectHitsWall(
  object: Equipment,
  wall: Wall,
  openings: Opening[],
): boolean {
  const shape = footprint(object);
  const box = boundingBox(shape);
  return wallObstacles(wall, openings, objectInterval(object)).some(
    (part) => boxesOverlap(box, boundingBox(part)) && polygonsOverlap(shape, part),
  );
}

/**
 * Middle of an opening, measured along its wall from the wall's `from` end.
 * Distance to the entrance is a rule in two places — the check that reports a
 * violation and the search that must not offer one — and both must measure it
 * from the same point.
 */
export function openingCentre(opening: Opening, wall: Wall): Point {
  const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
  if (length === 0) return wall.from;
  const along = opening.offset_m + opening.width_m / 2;
  return [
    wall.from[0] + ((wall.to[0] - wall.from[0]) / length) * along,
    wall.from[1] + ((wall.to[1] - wall.from[1]) / length) * along,
  ];
}

/**
 * Sector an object looks into: the wedge a camera covers, as a world polygon.
 *
 * Heading follows the object's own orientation — at rotation 0 the object faces
 * +Y, and the angle turns clockwise, exactly like `footprint`. The sector is a
 * conventional cone for planning coverage on the plan: it stops at `radius_m`
 * and walls do not cut it. Anything beyond that is a different task.
 *
 * At 360° and wider the result is a closed circle without the centre vertex —
 * a wedge that goes all the way round has no apex to draw.
 */
export function viewSector(
  centre: Point,
  rotation_deg: number,
  angle_deg: number,
  radius_m: number,
  steps = 24,
): Polygon {
  const span = Math.min(Math.max(angle_deg, 0), 360);
  const arc: Polygon = [];
  for (let step = 0; step <= steps; step += 1) {
    const at = rotation_deg - span / 2 + (span * step) / steps;
    // Local +Y turned by `at` clockwise: the same convention as toWorld.
    arc.push(toWorld(centre, [0, radius_m], at));
  }
  if (span >= 360) {
    // Последняя точка полного круга совпадает с первой — кольцо не замыкают дважды.
    return arc.slice(0, -1);
  }
  return [centre, ...arc];
}

/** Area of an object's floor projection. Rotation does not change it. */
export function footprintArea(object: Equipment): number {
  return polygonArea(footprint(object));
}
