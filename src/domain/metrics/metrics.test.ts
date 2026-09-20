/**
 * G03 acceptance: the numbers the assistant will quote.
 *
 * The case from the package card is the first test here — a 10×8 room with two
 * 2×2 objects overlapping by 1 m² gives 7 m² occupied and 73 m² free, not 8 and
 * 72. Every other test exists because getting it wrong is silent: a clipped
 * object, a camera on the wall, a zone inside a zone.
 */

import * as polyclip from 'polyclip-ts';
import { describe, expect, test } from 'vitest';
import type { Catalog, Equipment, ObjectType, PlanDocument, Point, Zone } from '../../contracts/model';
import { SCHEMA_VERSION } from '../../contracts/model';
import { footprint, polygonArea } from '../geometry';
import { METRICS_ISSUE_CODES, measurePlan } from './index';

const SQUARE: ObjectType = {
  id: 'ot_square',
  label: 'Квадрат 2×2',
  category: 'Тест',
  defaultSize_m: [2, 2],
  defaultHeight_m: 1,
  defaultBase_m: 0,
  physical: true,
  occupiesFloor: true,
  symbol: 'rect',
  color: '#4C6EF5',
  provenance: 'Допущение команды: условный объект для проверки площадей.',
  attributes: [],
};

/** Hangs on the wall: solid, but takes no floor. */
const CAMERA: ObjectType = {
  ...SQUARE,
  id: 'ot_camera_test',
  label: 'Камера',
  occupiesFloor: false,
  defaultBase_m: 2.5,
};

const catalog: Catalog = {
  version: 'test-1',
  objectTypes: [SQUARE, CAMERA],
  zoneTypes: [{ id: 'zt_any', label: 'Зона', color: '#E9ECEF', attributes: [] }],
  layerTypes: [],
  rules: [],
};

function object(id: string, position: Point, overrides: Partial<Equipment> = {}): Equipment {
  return {
    id,
    typeId: 'ot_square',
    label: id,
    position,
    size_m: [2, 2],
    rotation_deg: 0,
    base_m: 0,
    height_m: 1,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...overrides,
  };
}

function zone(id: string, polygon: Point[], parentId: string | null = null): Zone {
  return {
    id,
    typeId: 'zt_any',
    name: id,
    polygon,
    parentId,
    layerId: 'l_base',
    attributes: {},
  };
}

function plan(objects: Equipment[], zones: Zone[] = []): PlanDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'plan_metrics',
    name: 'Проверка площадей',
    room: {
      id: 'room_main',
      boundary: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      ceilingHeight_m: 3,
    },
    walls: [],
    openings: [],
    layers: [
      { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
    ],
    zones,
    objects,
    catalog,
    extensions: {},
  };
}

function measured(document: PlanDocument): { room: { total_m2: number; occupied_m2: number; free_m2: number }; zones: Record<string, { total_m2: number; occupied_m2: number; free_m2: number }> } {
  const result = measurePlan(document);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join(', '));
  return result.value;
}

describe('занятый пол — это объединение, а не сумма', () => {
  test('два квадрата 2×2 с перекрытием 1 м²: занято 7, свободно 73', () => {
    // Центры (1,1) и (2,2): квадраты 0..2 и 1..3 по обеим осям, общий угол 1×1.
    const metrics = measured(plan([object('a', [1, 1]), object('b', [2, 2])]));

    expect(metrics.room.total_m2).toBeCloseTo(80, 9);
    expect(metrics.room.occupied_m2).toBeCloseTo(7, 9);
    expect(metrics.room.free_m2).toBeCloseTo(73, 9);
  });

  test('те же два квадарта врозь занимают всю свою площадь', () => {
    const metrics = measured(plan([object('a', [1, 1]), object('b', [6, 6])]));
    expect(metrics.room.occupied_m2).toBeCloseTo(8, 9);
    expect(metrics.room.free_m2).toBeCloseTo(72, 9);
  });

  test('полностью совпадающие объекты занимают площадь одного', () => {
    const metrics = measured(plan([object('a', [4, 4]), object('b', [4, 4])]));
    expect(metrics.room.occupied_m2).toBeCloseTo(4, 9);
  });
});

describe('границы помещения', () => {
  test('часть объекта снаружи обрезается', () => {
    // Центр (10,4): половина квадрата за стеной x = 10.
    const metrics = measured(plan([object('edge', [10, 4])]));
    expect(metrics.room.occupied_m2).toBeCloseTo(2, 9);
    expect(metrics.room.free_m2).toBeCloseTo(78, 9);
  });

  test('объект целиком снаружи не занимает ничего', () => {
    const metrics = measured(plan([object('outside', [20, 20])]));
    expect(metrics.room.occupied_m2).toBeCloseTo(0, 9);
    expect(metrics.room.free_m2).toBeCloseTo(80, 9);
  });

  test('поворот не меняет площадь отпечатка', () => {
    const straight = measured(plan([object('a', [5, 4])])).room.occupied_m2;
    const turned = measured(
      plan([object('a', [5, 4], { rotation_deg: 37 })]),
    ).room.occupied_m2;
    expect(turned).toBeCloseTo(straight, 9);
  });
});

describe('что считается стоящим на полу', () => {
  test('камера на стене пол не занимает', () => {
    const metrics = measured(plan([object('cam', [5, 4], { typeId: 'ot_camera_test' })]));
    expect(metrics.room.occupied_m2).toBeCloseTo(0, 9);
  });

  test('неизвестный тип считается занимающим пол, а не пропускается', () => {
    const metrics = measured(plan([object('ghost', [5, 4], { typeId: 'ot_missing' })]));
    expect(metrics.room.occupied_m2).toBeCloseTo(4, 9);
  });
});

describe('зоны', () => {
  const outer = zone('z_outer', [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ]);
  const inner = zone(
    'z_inner',
    [
      [1, 1],
      [4, 1],
      [4, 4],
      [1, 4],
    ],
    'z_outer',
  );

  test('объект вложенной зоны занимает пол и у родителя', () => {
    const metrics = measured(plan([object('a', [2, 2])], [outer, inner]));

    expect(metrics.zones.z_inner?.occupied_m2).toBeCloseTo(4, 9);
    expect(metrics.zones.z_outer?.occupied_m2).toBeCloseTo(4, 9);
    expect(metrics.zones.z_inner?.free_m2).toBeCloseTo(5, 9);
    expect(metrics.zones.z_outer?.free_m2).toBeCloseTo(32, 9);
  });

  test('площади зон нельзя складывать: вложенные перекрываются', () => {
    const metrics = measured(plan([], [outer, inner]));
    const sum = Object.values(metrics.zones).reduce((total, area) => total + area.total_m2, 0);

    expect(metrics.zones.z_outer?.total_m2).toBeCloseTo(36, 9);
    expect(metrics.zones.z_inner?.total_m2).toBeCloseTo(9, 9);
    expect(sum).toBeGreaterThan(metrics.zones.z_outer?.total_m2 ?? 0);
  });

  test('объект на границе зоны учитывается только своей частью', () => {
    // Центр (6,3): половина квадрата снаружи z_outer (граница x = 6).
    const metrics = measured(plan([object('half', [6, 3])], [outer]));
    expect(metrics.zones.z_outer?.occupied_m2).toBeCloseTo(2, 9);
    expect(metrics.room.occupied_m2).toBeCloseTo(4, 9);
  });
});

describe('объединение с дыркой', () => {
  test('внутренний двор из четырёх стеллажей полом не считается', () => {
    // Кольцо 6×6 из четырёх полос: сами полосы 20 м², внутри дырка 4×4.
    const metrics = measured(
      plan([
        object('bottom', [5, 1.5], { size_m: [6, 1] }),
        object('top', [5, 6.5], { size_m: [6, 1] }),
        object('left', [2.5, 4], { size_m: [1, 4] }),
        object('right', [7.5, 4], { size_m: [1, 4] }),
      ]),
    );

    expect(metrics.room.occupied_m2).toBeCloseTo(20, 9);
    expect(metrics.room.free_m2).toBeCloseTo(60, 9);
  });
});

describe('локальная обрезка даёт то же, что полная (D-205)', () => {
  /** Reference: everything clipped by polyclip, no shortcuts. */
  function reference(document: PlanDocument, outline: Point[]): number {
    const closedRing = (ring: Point[]): [number, number][] => [
      ...ring.map((point): [number, number] => [point[0], point[1]]),
      [ring[0]![0], ring[0]![1]],
    ];
    const [first, ...rest] = document.objects.map((entry): polyclip.Geom => [[closedRing(footprint(entry))]]);
    if (first === undefined) throw new Error('нет объектов');
    const union = polyclip.union(first, ...rest);
    const clipped = polyclip.intersection(
      polyclip.intersection(union, [[closedRing(document.room.boundary)]]),
      [[closedRing(outline)]],
    );
    let total = 0;
    for (const polygon of clipped) {
      polygon.forEach((ring, index) => {
        const area = polygonArea(ring.slice(0, -1).map((point): Point => [point[0], point[1]]));
        total += index === 0 ? area : -area;
      });
    }
    return total;
  }

  test('объекты внутри, на границе, вне охвата и кольцо с двором — числа совпадают с полной обрезкой', () => {
    // Зона 6×6 в углу; вогнутая зона-«уголок» — чтобы вершины внутри не значили «целиком внутри».
    const square = zone('z_square', [[0, 0], [6, 0], [6, 6], [0, 6]]);
    const corner = zone('z_corner', [[4, 4], [10, 4], [10, 8], [7, 8], [7, 6], [4, 6]]);
    const document = plan(
      [
        object('inside', [2, 2]), // целиком в z_square
        object('edge', [6, 3]), // пополам на границе z_square
        object('far', [9, 1]), // вне охвата z_square
        object('outside-room', [10, 7]), // наполовину за стеной
        object('a', [8, 5], { size_m: [2, 1] }), // перекрывающиеся объекты в уголке
        object('b', [8.5, 5], { size_m: [2, 1] }),
        // Тонкая доска от (5; 5,5) к (8; 7,5): все четыре вершины внутри уголка, а
        // ребро проходит через вырез — «целиком внутри» решает не вершина (D-020: -33,69°).
        object('notch-edge', [6.5, 6.5], { size_m: [3.6, 0.2], rotation_deg: -33.69 }),
        // Кольцо с двором: полосы вокруг z_square по периметру 1..5.
        object('ring-bottom', [3, 1.5], { size_m: [4, 1] }),
        object('ring-top', [3, 4.5], { size_m: [4, 1] }),
        object('ring-left', [1.5, 3], { size_m: [1, 2] }),
        object('ring-right', [4.5, 3], { size_m: [1, 2] }),
      ],
      [square, corner],
    );

    const metrics = measured(document);
    expect(metrics.zones['z_square']!.occupied_m2).toBeCloseTo(reference(document, square.polygon), 9);
    expect(metrics.zones['z_corner']!.occupied_m2).toBeCloseTo(reference(document, corner.polygon), 9);
    expect(metrics.room.occupied_m2).toBeCloseTo(reference(document, document.room.boundary), 9);
    // И числа не вырожденные: в уголке лежит и кусок «across-notch», и объединение a∪b.
    expect(metrics.zones['z_corner']!.occupied_m2).toBeGreaterThan(2.5);
  });
});

describe('за стеной пола нет', () => {
  test('зона, вылезшая за помещение, считается только своей частью внутри', () => {
    const metrics = measured(
      plan(
        [object('outside', [11, 4])],
        [
          zone('z_over', [
            [8, 2],
            [14, 2],
            [14, 6],
            [8, 6],
          ]),
        ],
      ),
    );

    // Полигон зоны 6×4 = 24 м², но внутри помещения только 2×4 = 8 м².
    expect(metrics.zones.z_over?.total_m2).toBeCloseTo(8, 9);
    expect(metrics.zones.z_over?.occupied_m2).toBeCloseTo(0, 9);
    expect(metrics.room.occupied_m2).toBeCloseTo(0, 9);
  });
});

describe('невычислимая геометрия', () => {
  test('самопересекающийся контур помещения — отказ, а не выдуманное число', () => {
    const broken = plan([]);
    broken.room.boundary = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ];

    const result = measurePlan(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe(METRICS_ISSUE_CODES.AREA_UNCOMPUTABLE);
    expect(result.issues[0]?.polygon).toEqual(broken.room.boundary);
  });

  test('самопересекающаяся зона тоже останавливает расчёт', () => {
    const result = measurePlan(
      plan(
        [],
        [
          zone('z_bad', [
            [0, 0],
            [4, 4],
            [4, 0],
            [0, 4],
          ]),
        ],
      ),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.refs[0]?.id)).toEqual(['z_bad']);
  });
});

describe('пустой план', () => {
  test('без объектов занято ноль, свободно всё', () => {
    const metrics = measured(plan([]));
    expect(metrics.room.occupied_m2).toBe(0);
    expect(metrics.room.free_m2).toBeCloseTo(80, 9);
  });
});
