/**
 * G01: public geometry interface. Consumers import from here and never reach
 * into polygons.ts or coordinates.ts.
 *
 * This module knows nothing about the catalog: whether an object is `physical`
 * or `occupiesFloor` is a catalog question, so the caller applies those flags.
 * Geometry only answers where things are and whether they overlap. The one
 * exception is `guideObjects` (D-211): what to snap furniture to and measure
 * it against is decided here, and a sensor on the ceiling is not it.
 */

import type { Equipment, Id, Opening, PlanDocument, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { objectOutline } from '../../contracts/outline';
import { joinedWallSpan } from './wall-joints';
import { toWorld } from './coordinates';
import {
  settle,
  snapBox,
  strongerSource,
  type BoxSnap,
  type GuideSource,
  type LabelledGuides,
  type SnapGuides,
} from './snap';
import {
  boundingBox,
  boxGap,
  boxesOverlap,
  polygonGap,
  pointSegmentDistance,
  polygonArea,
  polygonContains,
  polygonsOverlap,
  segmentLength,
  type BoundingBox,
  type PolygonGap,
} from './polygons';

export {
  CIRCLE_OUTLINE_VERTICES,
  UNIT_SQUARE,
  objectOutline,
  sameOutline,
  symbolOutline,
  typeOutline,
  withTypeOutline,
} from '../../contracts/outline';
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
  boxGap,
  boxesOverlap,
  locatePoint,
  isSimplePolygon,
  pointSegmentDistance,
  polygonArea,
  polygonGap,
  polygonSegmentDistance,
  projectOnSegment,
  ringArea,
  segmentLength,
  segmentsProperlyCross,
  signedArea,
  type BoundingBox,
  type PointPosition,
  type PolygonGap,
} from './polygons';

export {
  ROOM_GRID_MIN_PX,
  SNAP,
  roomGridCoordinates,
  settle,
  settlePoint,
  snapAxis,
  snapBox,
  snapHint,
  snapPoint,
  strongerSource,
} from './snap';
export type {
  AxisHint,
  AxisSnap,
  BoxSnap,
  GuideSource,
  GuideSources,
  LabelledGuides,
  PointSnap,
  SnapGuides,
  SnapHint,
  SnapKind,
  SnapTarget,
} from './snap';

/**
 * The neighbours a moved object is aligned with and measured against: every
 * other object on a visible layer that stands on the floor. Furniture is
 * aligned with furniture, not with a smoke sensor or a camera (D-211).
 * `exclude` — the objects being moved: a thing must not snap to itself.
 */
export function guideObjects(plan: PlanDocument, exclude: ReadonlySet<Id>): Equipment[] {
  const hidden = new Set(plan.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const types = new Map(plan.catalog.objectTypes.map((type) => [type.id, type]));
  return plan.objects.filter((object) => {
    if (exclude.has(object.id) || hidden.has(object.layerId)) return false;
    const type = types.get(object.typeId);
    return type === undefined || (type.physical && type.occupiesFloor);
  });
}

/**
 * Guides of a plan for moving an object (D-208): the room outline's vertices,
 * the zones' vertices, the walls' faces (the rectangle of their thickness, not
 * the centreline — «flush to the wall» must not put the object inside it), and
 * the edges and the centre lines of every `guideObjects` neighbour's box.
 * A gesture passes `neighbours` once, so the plan is walked once for guides
 * and obstacles together.
 */
export function objectGuides(
  plan: PlanDocument,
  exclude: ReadonlySet<Id>,
  neighbours: readonly Equipment[] = guideObjects(plan, exclude),
): SnapGuides {
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
  for (const wall of plan.walls) for (const vertex of wallPolygon(wall, plan.walls, plan.openings)) add(vertex);
  for (const object of neighbours) {
    const box = boundingBox(footprint(object));
    xs.add(box.minX);
    xs.add(box.maxX);
    xs.add((box.minX + box.maxX) / 2);
    ys.add(box.minY);
    ys.add(box.maxY);
    ys.add((box.minY + box.maxY) / 2);
  }
  return { xs: [...xs], ys: [...ys] };
}

/** Something a moved object is measured against: its id, its ring and the ring's box. */
export type Obstacle = { id: Id; ring: Polygon; box: BoundingBox };

/** The nearest obstacle and the shortest line to it; `from` lies on the moved shape. */
export type Gap = PolygonGap & { id: Id };

/** What a move measures against, prepared once per gesture: wall footprints and neighbours. */
export type DragObstacles = { walls: Obstacle[]; objects: Obstacle[] };

/**
 * Obstacles of a plan for moving an object: each wall's footprint (its faces,
 * as for the guides) and each `guideObjects` neighbour's footprint. Built at
 * the start of a gesture, so a move only measures and never rebuilds rings.
 * A wall is one solid ring: a door or window opening is not cut out of it, so
 * the gap to a door is the gap to the wall around it.
 */
export function dragObstacles(
  plan: PlanDocument,
  exclude: ReadonlySet<Id>,
  neighbours: readonly Equipment[] = guideObjects(plan, exclude),
): DragObstacles {
  const obstacle = (id: Id, ring: Polygon): Obstacle => ({ id, ring, box: boundingBox(ring) });
  return {
    walls: plan.walls
      .map((wall) => obstacle(wall.id, wallPolygon(wall, plan.walls, plan.openings)))
      .filter((wall) => wall.ring.length >= 3),
    objects: neighbours.map((object) => obstacle(object.id, footprint(object))),
  };
}

/**
 * The obstacle nearest to `shape`, or null when there is none. A box that is
 * already farther than the best gap so far cannot hold a nearer ring, so a
 * plan of a thousand objects measures only the few around the moved one.
 */
export function nearestGap(shape: Polygon, obstacles: readonly Obstacle[]): Gap | null {
  const box = boundingBox(shape);
  let best: Gap | null = null;
  for (const obstacle of obstacles) {
    if (best !== null && boxGap(box, obstacle.box) >= best.distance) continue;
    const gap = polygonGap(shape, obstacle.ring);
    if (gap !== null && (best === null || gap.distance < best.distance)) best = { ...gap, id: obstacle.id };
  }
  return best;
}

/**
 * Distances of a moved object to the nearest wall and the nearest neighbour.
 * Shapes that overlap are zero apart and the points the gap would run between
 * are arbitrary, so there is no gap to show then.
 */
export function objectGaps(object: Equipment, obstacles: DragObstacles): { wall: Gap | null; object: Gap | null } {
  const shape = footprint(object);
  const apart = (gap: Gap | null): Gap | null => (gap !== null && gap.distance > 0 ? gap : null);
  return { wall: apart(nearestGap(shape, obstacles.walls)), object: apart(nearestGap(shape, obstacles.objects)) };
}

/**
 * Guides for drawing a vertex (D-209): every vertex the plan already has — the
 * room outline, the zones, the walls' axes and faces — so a new zone meets the
 * contour and a partition ends where another begins. Unlike an object, a
 * vertex may sit on a wall's axis: that is where the contour's own vertices are.
 *
 * Every coordinate carries what it belongs to (D-224), so the marker under the
 * cursor can say «стена» or «зона» before the click instead of leaving the
 * answer to the saved file.
 */
export function pointGuides(plan: PlanDocument): LabelledGuides {
  const xs = new Map<number, GuideSource>();
  const ys = new Map<number, GuideSource>();
  const add = (point: Point, source: GuideSource): void => {
    xs.set(point[0], strongerSource(xs.get(point[0]), source));
    ys.set(point[1], strongerSource(ys.get(point[1]), source));
  };
  // A zone on a hidden layer is not on screen: nothing to aim at (as for objects).
  const hidden = new Set(plan.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  for (const vertex of plan.room.boundary) add(vertex, 'room');
  for (const zone of plan.zones) {
    if (hidden.has(zone.layerId)) continue;
    for (const vertex of zone.polygon) add(vertex, 'zone');
  }
  for (const wall of plan.walls) {
    add(wall.from, 'wall');
    add(wall.to, 'wall');
    for (const vertex of wallPolygon(wall, plan.walls, plan.openings)) add(vertex, 'wall');
  }
  return { xs: [...xs.keys()], ys: [...ys.keys()], sources: { xs, ys } };
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

/**
 * Floor projection of a rotated object, as a world polygon: its outline
 * (D-277) scaled by `size_m`, turned and placed. Loading has already given
 * every object its type's shape, so a circle is checked as a circle here.
 */
export function footprint(object: Equipment): Polygon {
  const [width, depth] = object.size_m;
  return objectOutline(object).map(([u, v]) =>
    toWorld(object.position, [u * width, v * depth], object.rotation_deg),
  );
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

/** Wall footprint; neighbouring walls can join its endpoints with a shared mitre. */
export function wallPolygon(wall: Wall, walls: readonly Wall[] = [], openings: readonly Opening[] = []): Polygon {
  const length = wallLength(wall);
  if (length <= TOLERANCE.coordinate_m) return [];
  return wallSpanPolygon(wall, 0, length, wall.thickness_m, walls, openings);
}

/**
 * Wall footprint between two offsets from `wall.from` (metres); optional
 * neighbours join full endpoints, and opening cuts clip that joined footprint.
 * `thickness_m` defaults to the wall's own — a thinner value draws a pane
 * inside the wall, which is how the 3D view shows an opening.
 */
export function wallSpanPolygon(
  wall: Wall,
  start: number,
  end: number,
  thickness_m = wall.thickness_m,
  walls: readonly Wall[] = [],
  openings: readonly Opening[] = [],
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
  return thickness_m === wall.thickness_m ? joinedWallSpan(wall, [a, b, c, d], start, end, walls, openings) : [a, b, c, d];
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
  walls: readonly Wall[] = [],
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
      parts.push(wallSpanPolygon(wall, cursor, gap.start, wall.thickness_m, walls, openings));
    }
    cursor = Math.max(cursor, gap.end);
  }
  if (length - cursor > TOLERANCE.coordinate_m) {
    parts.push(wallSpanPolygon(wall, cursor, length, wall.thickness_m, walls, openings));
  }
  return parts.filter((part) => part.length >= 3);
}

/** Does an object run into a wall, openings at its height taken into account? */
export function objectHitsWall(
  object: Equipment,
  wall: Wall,
  openings: Opening[],
  walls: readonly Wall[] = [],
): boolean {
  const shape = footprint(object);
  const box = boundingBox(shape);
  return wallObstacles(wall, openings, objectInterval(object), walls).some(
    (part) => boxesOverlap(box, boundingBox(part)) && polygonsOverlap(shape, part),
  );
}

/**
 * Floor in front of an opening: its span along the wall, `depth_m` out on both
 * sides, the wall's own thickness between them. Empty for a zero-length wall.
 */
export function openingClearance(opening: Opening, wall: Wall, depth_m: number): Polygon {
  if (wallLength(wall) <= TOLERANCE.coordinate_m) return [];
  return wallSpanPolygon(wall, opening.offset_m, opening.offset_m + opening.width_m, wall.thickness_m + 2 * depth_m);
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

/**
 * Does the sector of `viewSector` hold `point`? The exact wedge, not its
 * polygon: the arc is a true circle here, while the drawn polygon cuts it into
 * `steps` chords. Same conventions — rotation 0 looks along +Y, positive turns
 * clockwise; the apex itself is inside; 360° and wider is a full circle.
 */
export function pointInViewSector(
  centre: Point,
  rotation_deg: number,
  angle_deg: number,
  radius_m: number,
  point: Point,
): boolean {
  return viewSectorTest(centre, rotation_deg, angle_deg, radius_m)(point);
}

/**
 * `pointInViewSector` with the sector fixed once: heading, half-angle cosine
 * and squared reach are computed here, the returned test is arithmetic only.
 * For grids that ask the same camera about thousands of points (D-307).
 */
export function viewSectorTest(
  centre: Point,
  rotation_deg: number,
  angle_deg: number,
  radius_m: number,
): (point: Point) => boolean {
  const [cx, cy] = centre;
  const reach = radius_m + TOLERANCE.coordinate_m;
  const reach2 = reach * reach;
  const apex2 = TOLERANCE.coordinate_m * TOLERANCE.coordinate_m;
  const span = Math.min(Math.max(angle_deg, 0), 360);
  const full = span >= 360;
  // Local +Y turned clockwise by the rotation, as in `toWorld`.
  const heading = (rotation_deg * Math.PI) / 180;
  const hx = Math.sin(heading);
  const hy = Math.cos(heading);
  // Within half the span of the heading ⇔ cos(off) ≥ cos(span / 2); a hair of
  // slack keeps a point exactly on an edge inside despite rounding.
  const cosHalf = Math.cos(((span / 2) * Math.PI) / 180) - 1e-12;
  return ([x, y]: Point): boolean => {
    const dx = x - cx;
    const dy = y - cy;
    const distance2 = dx * dx + dy * dy;
    if (distance2 > reach2) return false;
    if (distance2 <= apex2 || full) return true;
    return hx * dx + hy * dy >= cosHalf * Math.sqrt(distance2);
  };
}

/** Area of an object's floor projection. Rotation does not change it. */
export function footprintArea(object: Equipment): number {
  return polygonArea(footprint(object));
}
