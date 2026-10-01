/** Rectangular enclosure: reuse shared walls and add only missing spans, one undo. */
import type { Command } from '../../contracts/commands';
import type { Id, PlanDocument, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { nextFreeId, takenIds } from '../../domain/commands';
import { editableContentLayer } from '../../domain/content-layer';
import { boundingBox, contains, isSimplePolygon, intersects, locatePoint, objectHitsWall, pointSegmentDistance, segmentLength, wallPolygon, wallSpanPolygon } from '../../domain/geometry';
import { findObjectType } from '../../domain/catalog';
import { parentForRing } from './vertex-edit';
import { createWall, MIN_WALL_LENGTH_M } from './wall-draft';

const EPS = TOLERANCE.coordinate_m;
export type RoomDraftResult = { ok: true; command: Command; walls: Wall[]; polygon: Polygon } | { ok: false; message: string };

export function roomRectangle(a: Point, b: Point): Polygon {
  const left = Math.min(a[0], b[0]); const right = Math.max(a[0], b[0]);
  const bottom = Math.min(a[1], b[1]); const top = Math.max(a[1], b[1]);
  return [[left, bottom], [right, bottom], [right, top], [left, top]];
}

/** Snap to wall centre lines rather than their faces, so a shared wall stays shared. */
export function snapRoomCorner(point: Point, walls: Wall[], radius: number): Point {
  let x = point[0]; let y = point[1]; let dx = Infinity; let dy = Infinity;
  for (const wall of walls) {
    const limit = radius + wall.thickness_m / 2;
    if (pointSegmentDistance(point, wall.from, wall.to) > limit) continue;
    if (Math.abs(wall.from[0] - wall.to[0]) < EPS && Math.abs(point[0] - wall.from[0]) < dx) {
      x = wall.from[0]; dx = Math.abs(point[0] - x);
    }
    if (Math.abs(wall.from[1] - wall.to[1]) < EPS && Math.abs(point[1] - wall.from[1]) < dy) {
      y = wall.from[1]; dy = Math.abs(point[1] - y);
    }
  }
  return [x, y];
}

/** Split a segment at rectangle edges; an interior midpoint means it cuts the room. */
function cutsInterior(wall: Wall, polygon: Polygon): boolean {
  const box = boundingBox(polygon);
  const delta: Point = [wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]];
  const ts = [0, 1];
  for (const [axis, values] of [[0, [box.minX, box.maxX]], [1, [box.minY, box.maxY]]] as const) {
    if (Math.abs(delta[axis]) <= EPS) continue;
    for (const value of values) {
      const t = (value - wall.from[axis]) / delta[axis];
      if (t > 0 && t < 1) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  return ts.slice(1).some((end, index) => {
    const start = ts[index]!;
    if ((end - start) * segmentLength(wall.from, wall.to) <= EPS) return false;
    const t = (start + end) / 2;
    return locatePoint([wall.from[0] + t * delta[0], wall.from[1] + t * delta[1]], polygon) === 'inside';
  });
}

/** Collinear existing walls cover parts of an edge; keep those walls and their doors intact. */
function uncovered(from: Point, to: Point, walls: Wall[]): [Point, Point][] {
  const length = segmentLength(from, to);
  const spans: [number, number][] = [];
  for (const wall of walls) {
    // Distance to the infinite edge line (projection must not be clamped).
    const cross = (p: Point) => Math.abs((to[0] - from[0]) * (p[1] - from[1]) - (to[1] - from[1]) * (p[0] - from[0])) / length;
    if (cross(wall.from) > EPS || cross(wall.to) > EPS) continue;
    const parameter = (p: Point) => ((p[0] - from[0]) * (to[0] - from[0]) + (p[1] - from[1]) * (to[1] - from[1])) / (length * length);
    const a = parameter(wall.from); const b = parameter(wall.to);
    const start = Math.max(0, Math.min(a, b)); const end = Math.min(1, Math.max(a, b));
    if (end > start + EPS / length) spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const result: [Point, Point][] = [];
  const point = (t: number): Point => [from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])];
  let cursor = 0;
  for (const [start, end] of [...spans, [1, 1] as [number, number]]) {
    if (start > cursor + EPS / length) result.push([point(cursor), point(start)]);
    cursor = Math.max(cursor, end);
  }
  return result;
}

export function createInternalRoom(plan: PlanDocument, polygon: Polygon, retired: ReadonlySet<Id> = new Set()): RoomDraftResult {
  const fail = (message: string): RoomDraftResult => ({ ok: false, message });
  const box = boundingBox(polygon);
  if (polygon.some((point) => !point.every(Number.isFinite)) || polygon.length !== 4 || !isSimplePolygon(polygon) || polygon.some((p, i) => {
    const next = polygon[(i + 1) % 4]!;
    return Math.abs(p[0] - next[0]) > EPS && Math.abs(p[1] - next[1]) > EPS;
  }) || box.maxX - box.minX < MIN_WALL_LENGTH_M || box.maxY - box.minY < MIN_WALL_LENGTH_M) {
    return fail('Комната должна быть прямоугольной, шириной и длиной не меньше 20 см. Выберите два противоположных угла.');
  }
  if (!contains(plan.room.boundary, polygon)) return fail('Комната выходит за внешний контур отделения. Нарисуйте её внутри существующего помещения.');
  if (plan.walls.some((wall) => cutsInterior(wall, polygon))) return fail('Комната пересекает существующую стену. Пристыкуйте её к стене, не проводите контур сквозь неё.');
  const layer = editableContentLayer(plan.layers);
  const type = plan.catalog.zoneTypes[0];
  if (!layer || !type) return fail('Для комнаты нужен незапертый обычный слой и тип зоны в справочнике.');
  const taken = takenIds(plan, retired);
  const walls: Wall[] = [];
  for (let i = 0; i < polygon.length; i++) {
    for (const [from, to] of uncovered(polygon[i]!, polygon[(i + 1) % polygon.length]!, plan.walls)) {
      const wall = createWall(from, to, plan.room, taken);
      if (!wall) return fail('Между существующими стенами остаётся зазор меньше 20 см. Пристыкуйте углы точнее.');
      walls.push(wall);
    }
  }
  const perpendicular = (a: Wall, b: Wall): boolean => Math.abs((a.to[0] - a.from[0]) * (b.to[0] - b.from[0]) + (a.to[1] - a.from[1]) * (b.to[1] - b.from[1])) <= EPS * segmentLength(a.from, a.to) * segmentLength(b.from, b.to);
  if (walls.some((next) => plan.walls.some((existing) =>
    intersects(wallPolygon(next), wallPolygon(existing)) && (!perpendicular(next, existing) || (
    ![next.from, next.to].some((p) => pointSegmentDistance(p, existing.from, existing.to) <= EPS) &&
    ![existing.from, existing.to].some((p) => pointSegmentDistance(p, next.from, next.to) <= EPS)))
  ))) return fail('Новые стены накладываются на толщину существующих. Пристыкуйте углы к оси стены или увеличьте расстояние.');
  if (walls.some((next) => plan.openings.some((opening) => {
    const owner = plan.walls.find((wall) => wall.id === opening.wallId);
    return owner !== undefined && intersects(wallPolygon(next), wallSpanPolygon(owner, opening.offset_m, opening.offset_m + opening.width_m));
  }))) return fail('Новая перегородка перекрывает существующий проём. Передвиньте угол комнаты за край двери или окна.');
  if (walls.length === 0) return fail('Этот контур уже полностью окружён стенами. Добавьте зону внутри него, а не повторную комнату.');
  if (walls.some((wall) => plan.objects.some((object) => (findObjectType(plan.catalog, object.typeId)?.physical ?? true) && objectHitsWall(object, wall, [])))) {
    return fail('Новая стена пересекает оборудование. Переместите объект или измените размер комнаты.');
  }
  const command: Command = { type: 'batch', commands: [
    ...walls.map((wall): Command => ({ type: 'wall.put', wall })),
    { type: 'zone.put', zone: { id: nextFreeId('z_', taken), name: `Комната ${plan.zones.length + 1}`, typeId: type.id,
      polygon, parentId: parentForRing(polygon, plan.zones), layerId: layer.id, attributes: {} } },
  ] };
  return { ok: true, command, walls, polygon };
}
