/**
 * G01: polygon primitives. Pure functions, no UI and no boolean operations —
 * union of footprints belongs to G03.
 *
 * Touching without positive overlap area is not a collision (contracts v1).
 * Comparisons use TOLERANCE from the contracts, never a bare ===.
 */

import { TOLERANCE, type Point, type Polygon } from '../../contracts/model';

const EPS = TOLERANCE.coordinate_m;

export type BoundingBox = { minX: number; minY: number; maxX: number; maxY: number };

export type PointPosition = 'inside' | 'boundary' | 'outside';

/** Positive when the ring winds counter-clockwise in model axes. */
export function signedArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

export function polygonArea(polygon: Polygon): number {
  return Math.abs(signedArea(polygon));
}

export function boundingBox(polygon: Polygon): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Cheap rejection before the expensive checks. */
export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.minX < b.maxX - EPS &&
    b.minX < a.maxX - EPS &&
    a.minY < b.maxY - EPS &&
    b.minY < a.maxY - EPS
  );
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function onSegment(point: Point, from: Point, to: Point): boolean {
  if (Math.abs(cross(from, to, point)) > EPS) return false;
  const withinX =
    point[0] >= Math.min(from[0], to[0]) - EPS &&
    point[0] <= Math.max(from[0], to[0]) + EPS;
  const withinY =
    point[1] >= Math.min(from[1], to[1]) - EPS &&
    point[1] <= Math.max(from[1], to[1]) + EPS;
  return withinX && withinY;
}

/**
 * True only when the segments cross at an interior point of both. Shared
 * endpoints and collinear touching are deliberately not crossings.
 */
export function segmentsProperlyCross(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): boolean {
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  if (Math.abs(d1) <= EPS || Math.abs(d2) <= EPS) return false;
  if (Math.abs(d3) <= EPS || Math.abs(d4) <= EPS) return false;
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Ray casting, with the boundary reported separately. */
export function locatePoint(point: Point, polygon: Polygon): PointPosition {
  for (let i = 0; i < polygon.length; i += 1) {
    const from = polygon[i]!;
    const to = polygon[(i + 1) % polygon.length]!;
    if (onSegment(point, from, to)) return 'boundary';
  }

  const [px, py] = point;
  let inside = false;
  for (let i = 0; i < polygon.length; i += 1) {
    const from = polygon[i]!;
    const to = polygon[(i + 1) % polygon.length]!;
    const crossesY = from[1] > py !== to[1] > py;
    if (!crossesY) continue;
    const t = (py - from[1]) / (to[1] - from[1]);
    if (px < from[0] + t * (to[0] - from[0])) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function anyProperCrossing(a: Polygon, b: Polygon): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      if (segmentsProperlyCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Parameters along segment a where it meets segment b, including collinear
 * touching. Used to split an edge into parts that lie wholly inside or outside
 * the other polygon.
 */
function intersectionParams(a1: Point, a2: Point, b1: Point, b2: Point): number[] {
  const rx = a2[0] - a1[0];
  const ry = a2[1] - a1[1];
  const sx = b2[0] - b1[0];
  const sy = b2[1] - b1[1];
  const denom = rx * sy - ry * sx;
  const qpx = b1[0] - a1[0];
  const qpy = b1[1] - a1[1];

  if (Math.abs(denom) <= EPS) {
    if (Math.abs(qpx * ry - qpy * rx) > EPS) return [];
    const len2 = rx * rx + ry * ry;
    if (len2 <= EPS) return [];
    const t0 = (qpx * rx + qpy * ry) / len2;
    const t1 = ((b2[0] - a1[0]) * rx + (b2[1] - a1[1]) * ry) / len2;
    return [t0, t1].filter((t) => t >= -EPS && t <= 1 + EPS);
  }

  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return [];
  return [t];
}

/**
 * True when some part of an edge of `a` runs through the interior of `b`.
 * This is what catches two rectangles aligned on a shared side — a row of
 * desks — where every intersection lands on an edge endpoint and neither
 * polygon has a vertex strictly inside the other.
 */
function edgePassesThrough(a: Polygon, b: Polygon, position: 'inside' | 'outside'): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    const params = [0, 1];
    for (let j = 0; j < b.length; j += 1) {
      params.push(...intersectionParams(a1, a2, b[j]!, b[(j + 1) % b.length]!));
    }
    const sorted = params
      .filter((t) => t >= 0 && t <= 1)
      .sort((left, right) => left - right);
    for (let k = 1; k < sorted.length; k += 1) {
      const from = sorted[k - 1]!;
      const to = sorted[k]!;
      if (to - from <= EPS) continue;
      const mid = (from + to) / 2;
      const point: Point = [a1[0] + (a2[0] - a1[0]) * mid, a1[1] + (a2[1] - a1[1]) * mid];
      if (locatePoint(point, b) === position) return true;
    }
  }
  return false;
}

/**
 * Whole-footprint containment: every vertex inside or on the border and no edge
 * crossing out. Checking only the centre or the vertices is wrong for a concave
 * container, which is exactly the shape a post office zone can have.
 */
export function polygonContains(container: Polygon, shape: Polygon): boolean {
  for (const vertex of shape) {
    if (locatePoint(vertex, container) === 'outside') return false;
  }
  if (anyProperCrossing(container, shape)) return false;
  // An edge can leave through a concave vertex and return through another:
  // neither contact is a proper crossing, yet the segment between them is outside.
  return !edgePassesThrough(shape, container, 'outside');
}

/** Positive overlap area. Sharing an edge or a corner is not an overlap. */
export function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  if (!boxesOverlap(boundingBox(a), boundingBox(b))) return false;
  if (anyProperCrossing(a, b)) return true;
  if (a.some((vertex) => locatePoint(vertex, b) === 'inside')) return true;
  if (b.some((vertex) => locatePoint(vertex, a) === 'inside')) return true;
  if (edgePassesThrough(a, b, 'inside')) return true;
  if (edgePassesThrough(b, a, 'inside')) return true;
  // Identical or nested rings touch only along the border, yet still overlap.
  if (polygonContains(a, b) && polygonArea(b) > TOLERANCE.area_m2) return true;
  if (polygonContains(b, a) && polygonArea(a) > TOLERANCE.area_m2) return true;
  return false;
}

/** Axis-aligned rectangle given its centre, before rotation. */
export function rectangleCorners(centre: Point, size: Point): Polygon {
  const [cx, cy] = centre;
  const halfX = size[0] / 2;
  const halfY = size[1] / 2;
  return [
    [cx - halfX, cy - halfY],
    [cx + halfX, cy - halfY],
    [cx + halfX, cy + halfY],
    [cx - halfX, cy + halfY],
  ];
}

/**
 * A ring is usable for area and containment only when it is simple: at least
 * three vertices, positive area and no self-intersection. Extends G01 for the
 * benefit of G02/G03, which must refuse to compute rather than return NaN.
 */
export function isSimplePolygon(polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  if (polygonArea(polygon) <= TOLERANCE.area_m2) return false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % polygon.length]!;
    if (Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) <= EPS) return false;
    for (let j = i + 1; j < polygon.length; j += 1) {
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % polygon.length]!;
      // Adjacent edges may share exactly their common endpoint, but cannot
      // retrace each other. Other edges cannot touch even at an endpoint.
      if (j === i + 1) {
        if (onSegment(b2, a1, a2) || onSegment(a1, b1, b2)) return false;
        continue;
      }
      if (i === 0 && j === polygon.length - 1) {
        if (onSegment(b1, a1, a2) || onSegment(a2, b1, b2)) return false;
        continue;
      }
      if (segmentsProperlyCross(a1, a2, b1, b2)) return false;
      if (onSegment(a1, b1, b2) || onSegment(a2, b1, b2) ||
          onSegment(b1, a1, a2) || onSegment(b2, a1, a2)) return false;
    }
  }
  return true;
}

/** Euclidean length of the segment `from → to`. */
export function segmentLength(from: Point, to: Point): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

/**
 * Where a point falls against a segment: `t` in [0, 1] is the clamped position
 * along it, `foot` the closest point of the segment, `distance` how far the
 * point is from that foot. Every "snap to edge", "offset along a wall" and
 * "is it near this wall" in the project is this one computation.
 */
export function projectOnSegment(
  point: Point,
  from: Point,
  to: Point,
): { t: number; foot: Point; distance: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPS * EPS) {
    return { t: 0, foot: from, distance: segmentLength(from, point) };
  }
  const along = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSq;
  const t = Math.min(1, Math.max(0, along));
  const foot: Point = [from[0] + t * dx, from[1] + t * dy];
  return { t, foot, distance: segmentLength(foot, point) };
}

/** Distance from a point to a segment (zero on the segment). */
export function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  return projectOnSegment(point, from, to).distance;
}

/** Nearest approach of two segments; zero when they cross. */
function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsProperlyCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/**
 * Gap between a polygon and a segment, in metres; zero when they touch, cross
 * or the segment runs inside. The assistant asks it how close a placement is to
 * a wall, so the primitive lives here instead of being copied into the advice
 * package.
 */
export function polygonSegmentDistance(polygon: Polygon, from: Point, to: Point): number {
  if (polygon.length < 3) return Number.POSITIVE_INFINITY;
  if (locatePoint(from, polygon) !== 'outside') return 0;

  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const edgeFrom = polygon[i]!;
    const edgeTo = polygon[(i + 1) % polygon.length]!;
    nearest = Math.min(nearest, segmentDistance(edgeFrom, edgeTo, from, to));
    if (nearest <= EPS) return 0;
  }
  return nearest;
}
