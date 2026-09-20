/**
 * G01: public geometry interface. Consumers import from here and never reach
 * into polygons.ts or coordinates.ts.
 *
 * This module knows nothing about the catalog: whether an object is `physical`
 * or `occupiesFloor` is a catalog question, so the caller applies those flags.
 * Geometry only answers where things are and whether they overlap.
 */

import type { Equipment, Id, Opening, PlanDocument, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { toWorld } from './coordinates';
import { settle, snapBox, type BoxSnap, type SnapGuides } from './snap';
import {
  boundingBox,
  boxesOverlap,
  pointSegmentDistance,
  polygonArea,
  polygonContains,
  polygonsOverlap,
  rectangleCorners,
  segmentLength,
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
  pointSegmentDistance,
  polygonArea,
  polygonSegmentDistance,
  projectOnSegment,
  segmentLength,
  segmentsProperlyCross,
  signedArea,
  type BoundingBox,
  type PointPosition,
} from './polygons';

export { SNAP, settle, settlePoint, snapAxis, snapBox, snapPoint } from './snap';
export type { AxisSnap, BoxSnap, PointSnap, SnapGuides, SnapKind } from './snap';

/**
 * Guides of a plan for moving an object (D-208): the room outline's vertices,
 * the zones' vertices, the walls' faces (the rectangle of their thickness, not
 * the centreline — «flush to the wall» must not put the object inside it) and
 * the boxes of every other floor-standing object on a visible layer. `exclude` — the objects
 * being moved: a thing must not snap to itself.
 */
export function objectGuides(plan: PlanDocument, exclude: ReadonlySet<Id>): SnapGuides {
  const xs = new Set<number>();
  const ys = new Set<number>();
  const add = (point: Point): void => {
    xs.add(point[0]);
    ys.add(point[1]);
  };
  // A contour or zone vertex on a wall's axis is inside that wall: the wall's
  // faces are the guides there, and the axis would pull the object into it.
  const onWallAxis = (point: Point): boolean =>
    plan.walls.some((wall) => pointSegmentDistance(point, wall.from, wall.to) <= TOLERANCE.coordinate_m);
  for (const vertex of plan.room.boundary) if (!onWallAxis(vertex)) add(vertex);
  for (const zone of plan.zones) for (const vertex of zone.polygon) if (!onWallAxis(vertex)) add(vertex);
  for (const wall of plan.walls) for (const vertex of wallPolygon(wall)) add(vertex);
  const hidden = new Set(plan.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  // Furniture is aligned with furniture, not with a smoke sensor or a camera:
  // only what the catalog says stands on the floor is a guide (D-211).
  const types = new Map(plan.catalog.objectTypes.map((type) => [type.id, type]));
  for (const object of plan.objects) {
    if (exclude.has(object.id) || hidden.has(object.layerId)) continue;
    const type = types.get(object.typeId);
    if (type !== undefined && !(type.physical && type.occupiesFloor)) continue;
    const box = boundingBox(footprint(object));
    xs.add(box.minX);
    xs.add(box.maxX);
    ys.add(box.minY);
    ys.add(box.maxY);
  }
  return { xs: [...xs], ys: [...ys] };
}

/**
 * Guides for drawing a vertex (D-209): every vertex the plan already has — the
 * room outline, the zones, the walls' axes and faces — so a new zone meets the
 * contour and a partition ends where another begins. Unlike an object, a
 * vertex may sit on a wall's axis: that is where the contour's own vertices are.
 */
export function pointGuides(plan: PlanDocument): SnapGuides {
  const xs = new Set<number>();
  const ys = new Set<number>();
  const add = (point: Point): void => {
    xs.add(point[0]);
    ys.add(point[1]);
  };
  // A zone on a hidden layer is not on screen: nothing to aim at (as for objects).
  const hidden = new Set(plan.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  for (const vertex of plan.room.boundary) add(vertex);
  for (const zone of plan.zones) {
    if (hidden.has(zone.layerId)) continue;
    for (const vertex of zone.polygon) add(vertex);
  }
  for (const wall of plan.walls) {
    add(wall.from);
    add(wall.to);
    for (const vertex of wallPolygon(wall)) add(vertex);
  }
  return { xs: [...xs], ys: [...ys] };
}

/**
 * Where an object lands when its centre is dragged to `centre`: its box at
 * that centre is snapped and the centre moves with it; the result is settled
 * for storage (guide axes to the millimetre, the rest to the centimetre).
 */
export function snapObjectCentre(
  object: Equipment,
  centre: Point,
  guides: SnapGuides,
  step: number | null,
  tolerance: number,
): { centre: Point; snap: BoxSnap } {
  const box = boundingBox(footprint({ ...object, position: centre }));
  const snap = snapBox(box, guides, step, tolerance);
  return { centre: [settle(centre[0] + snap.dx, snap.x), settle(centre[1] + snap.dy, snap.y)], snap };
}

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

/** Length of a wall's centreline in metres. */
export function wallLength(wall: Wall): number {
  return segmentLength(wall.from, wall.to);
}

/** The wall as a rectangle of its own thickness. */
export function wallPolygon(wall: Wall): Polygon {
  const length = wallLength(wall);
  if (length <= TOLERANCE.coordinate_m) return [];
  return wallSpanPolygon(wall, 0, length);
}

/**
 * A rectangle along the wall between two offsets from `wall.from` (metres);
 * `thickness_m` defaults to the wall's own — a thinner value draws a pane
 * inside the wall, which is how the 3D view shows an opening.
 */
export function wallSpanPolygon(
  wall: Wall,
  start: number,
  end: number,
  thickness_m = wall.thickness_m,
): Polygon {
  const [fx, fy] = wall.from;
  const [tx, ty] = wall.to;
  const length = wallLength(wall);
  const ux = (tx - fx) / length;
  const uy = (ty - fy) / length;
  const half = thickness_m / 2;
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
  const length = wallLength(wall);
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
  const length = wallLength(wall);
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
