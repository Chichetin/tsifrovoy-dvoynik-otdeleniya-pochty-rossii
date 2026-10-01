/** Mitred endpoint joins: two walls share the same face intersection, without square-cap notches. */
import type { Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { pointSegmentDistance, segmentLength } from './polygons';
const EPS = TOLERANCE.coordinate_m;
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const near = (a: Point, b: Point): boolean => segmentLength(a, b) <= EPS;

export function joinedWallSpan(wall: Wall, polygon: Polygon, start: number, end: number, walls: readonly Wall[]): Polygon {
  const length = segmentLength(wall.from, wall.to);
  if (length <= EPS || polygon.length !== 4) return polygon;
  const u: Point = [(wall.to[0] - wall.from[0]) / length, (wall.to[1] - wall.from[1]) / length];
  if (walls.length === 0 || start < -EPS || end > length + EPS) return polygon;
  const normal: Point = [-u[1] * wall.thickness_m / 2, u[0] * wall.thickness_m / 2];
  const base: Polygon = [
    [wall.from[0] + normal[0], wall.from[1] + normal[1]],
    [wall.to[0] + normal[0], wall.to[1] + normal[1]],
    [wall.to[0] - normal[0], wall.to[1] - normal[1]],
    [wall.from[0] - normal[0], wall.from[1] - normal[1]],
  ];
  let result = base.map((p): Point => [...p]);
  for (const atStart of [true, false]) {
    const point = atStart ? wall.from : wall.to;
    const incident = walls.filter((other) => other.id !== wall.id && pointSegmentDistance(point, other.from, other.to) <= EPS);
    // A T or multi-way junction already overlaps naturally. Do not guess a pairing.
    if (incident.length !== 1) continue;
    const other = incident[0]!;
    const otherEnd = near(point, other.from) ? other.to : near(point, other.to) ? other.from : null;
    if (otherEnd === null || Math.abs(other.height_m - wall.height_m) > EPS) continue;
    const otherLength = segmentLength(point, otherEnd);
    if (otherLength <= EPS) continue;
    const v: Point = [(otherEnd[0] - point[0]) / otherLength, (otherEnd[1] - point[1]) / otherLength];
    const denominator = cross(u, v);
    // Parallel walls and sharp angles keep their original caps instead of huge spikes.
    if (Math.abs(denominator) < 0.25) continue;
    const indices = atStart ? [0, 3] : [1, 2];
    const joined: Point[] = [];
    let safe = true;
    for (const [sideIndex, index] of indices.entries()) {
      const ownSide = sideIndex === 0 ? 1 : -1;
      const otherSide = -ownSide * (atStart ? 1 : -1);
      const q: Point = [point[0] - v[1] * other.thickness_m / 2 * otherSide, point[1] + v[0] * other.thickness_m / 2 * otherSide];
      const a = base[index]!;
      const delta: Point = [q[0] - a[0], q[1] - a[1]];
      const offset = cross(delta, v) / denominator;
      if (Math.abs(cross(delta, u) / denominator) > Math.min(otherLength * 0.45, 2 * Math.max(wall.thickness_m, other.thickness_m))) safe = false;
      joined.push([a[0] + u[0] * offset, a[1] + u[1] * offset]);
    }
    const limit = Math.min(length * 0.45, 2 * Math.max(wall.thickness_m, other.thickness_m));
    if (!safe || joined.some((p, i) => segmentLength(p, base[indices[i]!]!) > limit)) continue;
    indices.forEach((index, i) => { result[index] = joined[i]!; });
  }
  // Cut the joined full footprint at door/window boundaries. Moving a mitred
  // cap onto a very short residual span would make a bow-tie polygon.
  const along = (p: Point): number => (p[0] - wall.from[0]) * u[0] + (p[1] - wall.from[1]) * u[1];
  const clip = (input: Polygon, offset: number, keepAfter: boolean): Polygon => {
    const output: Polygon = [];
    const inside = (p: Point): boolean => keepAfter ? along(p) >= offset - EPS : along(p) <= offset + EPS;
    for (let index = 0; index < input.length; index++) {
      const a = input[index]!; const b = input[(index + 1) % input.length]!;
      const aInside = inside(a); const bInside = inside(b);
      if (aInside) output.push(a);
      if (aInside !== bInside) {
        const t = (offset - along(a)) / (along(b) - along(a));
        output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    const unique = output.filter((p, index) => !near(p, output[(index + output.length - 1) % output.length]!));
    return unique.length < 3 ? [] : unique;
  };
  if (start > EPS) result = clip(result, start, true);
  if (end < length - EPS) result = clip(result, end, false);
  return result;
}
