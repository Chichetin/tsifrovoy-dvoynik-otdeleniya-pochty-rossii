import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Equipment, PlanDocument, Polygon, Zone } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { locatePoint } from '../geometry';
import {
  COVERAGE_GRID,
  cameraCoverage,
  clientZones,
  fieldRepresentationFor,
  isClientZone,
  type CameraFieldRepresentation,
} from './camera-coverage';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(path);
  return parsed.value;
}

const demo = load('demo/before.json');
const representation = fieldRepresentationFor(demo.catalog, 'ot_camera') as CameraFieldRepresentation;

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function zone(id: string, polygon: Polygon, over: Partial<Zone> = {}): Zone {
  return { id, typeId: 'zt_client', name: id, polygon, parentId: null, layerId: 'l_base', attributes: {}, ...over };
}

function camera(id: string, position: [number, number], rotation_deg: number, angle: number, range: number): Equipment {
  return {
    id,
    typeId: 'ot_camera',
    label: id,
    position,
    size_m: [0.15, 0.15],
    rotation_deg,
    base_m: 2.6,
    height_m: 0.15,
    zoneId: null,
    layerId: 'l_base',
    attributes: { viewAngleDeg: angle, viewRangeM: range },
  };
}

function plan(zones: Zone[], objects: Equipment[]): Pick<PlanDocument, 'zones' | 'objects' | 'catalog'> {
  return { zones, objects, catalog: demo.catalog };
}

describe('какие зоны клиентские (D-306)', () => {
  test('тип «Клиентская зона» — по умолчанию справочника, служебная — нет', () => {
    const client = zone('z_a', rect(0, 0, 1, 1));
    const service = zone('z_b', rect(0, 0, 1, 1), { typeId: 'zt_service' });
    expect(isClientZone(plan([client, service], []), client)).toBe(true);
    expect(isClientZone(plan([client, service], []), service)).toBe(false);
  });

  test('собственный атрибут сильнее умолчания типа', () => {
    const closed = zone('z_a', rect(0, 0, 1, 1), { attributes: { publicAccess: false } });
    const opened = zone('z_b', rect(0, 0, 1, 1), { typeId: 'zt_service', attributes: { publicAccess: true } });
    expect(isClientZone(plan([closed, opened], []), closed)).toBe(false);
    expect(isClientZone(plan([closed, opened], []), opened)).toBe(true);
  });

  test('вложенная зона без признака наследует его от родителя, отдельная — нет', () => {
    const hall = zone('z_hall', rect(0, 0, 4, 4));
    const queue = zone('z_queue', rect(0, 0, 2, 2), { typeId: 'zt_queue', parentId: 'z_hall' });
    const storage = zone('z_store', rect(5, 0, 6, 1), { typeId: 'zt_storage' });
    const inService = zone('z_q2', rect(5, 0, 6, 1), { typeId: 'zt_queue', parentId: 'z_back' });
    const back = zone('z_back', rect(5, 0, 8, 3), { typeId: 'zt_service' });
    const all = plan([hall, queue, storage, inService, back], []);
    expect(clientZones(all).map((entry) => entry.id)).toEqual(['z_hall', 'z_queue']);
  });

  test('цикл родителей в недорисованном плане не зависает', () => {
    const a = zone('z_a', rect(0, 0, 1, 1), { typeId: 'zt_queue', parentId: 'z_b' });
    const b = zone('z_b', rect(0, 0, 1, 1), { typeId: 'zt_queue', parentId: 'z_a' });
    expect(isClientZone(plan([a, b], []), a)).toBe(false);
  });

  test('демо-план: зал и вложенные в него вход, ожидание, очередь; служебные — нет', () => {
    expect(clientZones(demo).map((entry) => entry.id)).toEqual(['z_client', 'z_entrance', 'z_waiting', 'z_queue']);
  });
});

describe('покрытие клиентских зон камерами', () => {
  test('зона без камер — 0 %, вся площадь — слепое пятно', () => {
    const result = cameraCoverage(plan([zone('z_a', rect(0, 0, 2, 2))], []), representation);
    expect(result.total.cells).toBe(64);
    expect(result.total.percent).toBe(0);
    expect(result.zones[0]).toMatchObject({ zoneId: 'z_a', percent: 0, blind_m2: 4, cameraIds: [] });
  });

  test('одна камера на всю зону — 100 %, слепых пятен нет', () => {
    const result = cameraCoverage(plan([zone('z_a', rect(0, 0, 2, 2))], [camera('eq_c', [1, 1], 0, 360, 5)]), representation);
    expect(result.total.percent).toBe(100);
    expect(result.blind).toEqual([]);
    expect(result.zones[0]?.cameraIds).toEqual(['eq_c']);
  });

  test('перекрытие двух секторов не даёт двойного счёта', () => {
    // Zone 4 × 1 m. Each camera looks up (+Y) with 180° and reaches 2.5 m:
    // together they see everything, and the middle is seen by both.
    const zones = [zone('z_a', rect(0, 0, 4, 1))];
    const left = camera('eq_l', [1.5, 0], 0, 180, 2.5);
    const right = camera('eq_r', [2.5, 0], 0, 180, 2.5);
    const alone = cameraCoverage(plan(zones, [left]), representation);
    const both = cameraCoverage(plan(zones, [left, right]), representation);
    expect(both.total.cells).toBe(64);
    expect(both.total.covered).toBe(64);
    expect(both.total.percent).toBe(100);
    expect(alone.total.covered).toBeLessThan(64);
    // The same camera twice adds nothing.
    const twice = cameraCoverage(plan(zones, [left, { ...left, id: 'eq_l2' }]), representation);
    expect(twice.total.covered).toBe(alone.total.covered);
  });

  test('поворот камеры: смотрит в зону — видит, отвернулась — нет', () => {
    const zones = [zone('z_a', rect(0, 0, 2, 2))];
    const facing = cameraCoverage(plan(zones, [camera('eq_c', [1, 0], 0, 180, 5)]), representation);
    const away = cameraCoverage(plan(zones, [camera('eq_c', [1, 0], 180, 180, 5)]), representation);
    const sideways = cameraCoverage(plan(zones, [camera('eq_c', [1, 0], 90, 180, 5)]), representation);
    expect(facing.total.percent).toBe(100);
    expect(away.total.percent).toBe(0);
    // Turned to +X, it sees the right half: centres with x ≥ 1.
    expect(sideways.total.percent).toBe(50);
  });

  test('зона дальше дальности — не видна', () => {
    const zones = [zone('z_a', rect(0, 0, 2, 2))];
    const result = cameraCoverage(plan(zones, [camera('eq_c', [10, 10], 0, 360, 2)]), representation);
    expect(result.total.percent).toBe(0);
  });

  test('без атрибутов у камеры берутся умолчания слоя', () => {
    const zones = [zone('z_a', rect(0, 0, 2, 2))];
    const bare = { ...camera('eq_c', [1, -5], 0, 0, 0), attributes: {} };
    // Layer defaults 90° and 6 m: from 5 m below, looking up, the near part of the square is in reach.
    const result = cameraCoverage(plan(zones, [bare]), representation);
    expect(result.cameras[0]).toMatchObject({ angle_deg: representation.angle_deg, range_m: representation.range_m });
    expect(result.total.covered).toBeGreaterThan(0);
  });

  test('вложенная зона не удваивает площадь в итоге, у неё — свой процент', () => {
    const hall = zone('z_hall', rect(0, 0, 4, 4));
    const queue = zone('z_queue', rect(0, 0, 2, 2), { typeId: 'zt_queue', parentId: 'z_hall' });
    const result = cameraCoverage(plan([hall, queue], [camera('eq_c', [1, 1], 0, 360, 1.5)]), representation);
    expect(result.total.cells).toBe(256);
    expect(result.total.area_m2).toBe(16);
    const byId = new Map(result.zones.map((entry) => [entry.zoneId, entry]));
    expect(byId.get('z_queue')?.percent).toBe(100);
    // The hall holds every square, so its share is the total's; the circle reaches past the queue.
    expect(byId.get('z_hall')?.covered).toBe(result.total.covered);
    expect(byId.get('z_hall')?.percent).toBeCloseTo((result.total.covered / 256) * 100, 9);
    expect(result.total.covered).toBeGreaterThan(64);
  });

  test('полосы слепых пятен складываются в слепую площадь и не заходят на видимое', () => {
    const zones = [zone('z_a', rect(0, 0, 3, 2))];
    const result = cameraCoverage(plan(zones, [camera('eq_c', [0, 0], 45, 90, 1.6)]), representation);
    const stripped = result.blind.reduce((sum, strip) => sum + strip.width * strip.height, 0);
    expect(stripped).toBeCloseTo(result.total.blind_m2, 9);
    expect(result.blind.every((strip) => strip.height === COVERAGE_GRID.cell_m)).toBe(true);
    // The corner square next to the camera is seen, so no strip starts at the origin.
    expect(result.blind.some((strip) => strip.x === 0 && strip.y === 0)).toBe(false);
  });
});

describe('квадраты зоны по строкам — то же, что проверка каждой точки', () => {
  const bruteForce = (polygon: Polygon): number => {
    let count = 0;
    for (let iy = -20; iy < 60; iy += 1) {
      for (let ix = -20; ix < 60; ix += 1) {
        const centre: [number, number] = [(ix + 0.5) * 0.25, (iy + 0.5) * 0.25];
        if (locatePoint(centre, polygon) !== 'outside') count += 1;
      }
    }
    return count;
  };
  const shapes: Record<string, Polygon> = {
    'вогнутая Г': [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]],
    'треугольник': [[0, 0], [5, 0], [1.3, 4.1]],
    'рёбра по центрам квадратов': rect(0.125, 0.375, 2.625, 1.875),
    'вершина на линии центров': [[0, 0.625], [2, 0], [3.5, 0.625], [2, 2.125]],
  };
  for (const [name, polygon] of Object.entries(shapes)) {
    test(name, () => {
      const result = cameraCoverage(plan([zone('z_a', polygon)], []), representation);
      expect(result.total.cells).toBe(bruteForce(polygon));
    });
  }
});

describe('числа на демо-планах', () => {
  test('demo/before.json: 93,8 % клиентской площади видно, слепых 4 м² (камеры повёрнуты внутрь, #118)', () => {
    const result = cameraCoverage(demo, representation);
    expect(result.total).toMatchObject({ cells: 1036, covered: 972, area_m2: 64.75, covered_m2: 60.75, blind_m2: 4 });
    expect(result.total.percent).toBeCloseTo(93.82, 2);
    const byId = Object.fromEntries(result.zones.map((entry) => [entry.zoneId, entry]));
    expect(byId.z_client).toMatchObject({ covered: 972, cameraIds: ['eq_25', 'eq_26', 'eq_39', 'eq_45'] });
    expect(byId.z_waiting?.percent).toBeCloseTo(95.86, 2);
    expect(byId.z_waiting?.cameraIds).toEqual(['eq_25', 'eq_26']);
    expect(byId.z_entrance?.percent).toBeCloseTo(99.38, 2);
    expect(byId.z_queue?.percent).toBe(100);
    // Cameras of the service rooms do not count towards the client area.
    expect(result.cameras.map((field) => field.objectId)).toEqual(['eq_25', 'eq_26', 'eq_39', 'eq_45']);
  });

  test('demo/after.json: те же камеры — те же числа', () => {
    const after = load('demo/after.json');
    expect(cameraCoverage(after, representation).total.covered).toBe(972);
  });
});
