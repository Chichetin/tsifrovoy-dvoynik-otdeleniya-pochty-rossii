/**
 * D-208: snapping arithmetic. What is checked is the rule, not the numbers:
 * a guide beats the grid, tolerance is a hard limit, each axis is independent,
 * a moved object never snaps to itself, hidden layers do not pull.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { objectGuides, pointGuides, settle, settlePoint, snapAxis, snapBox, snapObjectCentre, snapPoint } from './index';

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`Фикстура ${name} не разобралась`);
  return parsed.value;
}

describe('snapAxis', () => {
  test('направляющая в допуске побеждает сетку, даже если узел сетки ближе', () => {
    // 2.04: узел сетки 2.0 (0.04), направляющая 2.09 (0.05) — берётся направляющая.
    expect(snapAxis(2.04, [2.09], 0.5, 0.1)).toEqual({ value: 2.09, delta: expect.closeTo(0.05, 9), kind: 'guide' });
  });

  test('вне допуска — ничего; сетка — только когда направляющих рядом нет', () => {
    expect(snapAxis(2.3, [2.09], 0.5, 0.1)).toBeNull();
    expect(snapAxis(2.46, [], 0.5, 0.1)).toEqual({ value: 2.5, delta: expect.closeTo(0.04, 9), kind: 'grid' });
    expect(snapAxis(2.46, [], null, 0.1)).toBeNull();
  });

  test('из нескольких направляющих берётся ближайшая', () => {
    expect(snapAxis(5, [4.92, 5.03, 5.2], null, 0.1)?.value).toBe(5.03);
  });
});

describe('snapBox', () => {
  const guides = { xs: [3], ys: [] };

  test('к направляющей притягивается ближайшая грань, оси независимы', () => {
    // Коробка 1×1: правая грань 2.95 → 3 (dx +0.05); по y направляющих нет, сетка 0.5: minY 1.02 → 1.
    const snap = snapBox({ minX: 1.95, maxX: 2.95, minY: 1.02, maxY: 2.02 }, guides, 0.5, 0.1);
    expect(snap.dx).toBeCloseTo(0.05, 9);
    expect(snap.x?.kind).toBe('guide');
    expect(snap.dy).toBeCloseTo(-0.02, 9);
    expect(snap.y?.kind).toBe('grid');
  });

  test('к сетке тянутся только грани и с половинным допуском, центр — только к направляющим', () => {
    // Центр 1,78 в 0,22 от узла 2,0 при допуске 0,3 — к сетке центр не предлагается;
    // грани 1,28 и 2,28 в 0,22 от узлов, а сеточный допуск — 0,15: свободное движение.
    expect(snapBox({ minX: 1.28, maxX: 2.28, minY: 1.28, maxY: 2.28 }, { xs: [], ys: [] }, 0.5, 0.3)).toEqual({
      dx: 0, dy: 0, x: null, y: null,
    });
    // Та же коробка при направляющей 2,0: центр 1,78 ложится на неё (осевая линия соседа).
    const centred = snapBox({ minX: 1.28, maxX: 2.28, minY: 0, maxY: 1 }, { xs: [2], ys: [] }, 0.5, 0.3);
    expect(centred.dx).toBeCloseTo(0.22, 9);
    expect(centred.x?.kind).toBe('guide');
  });

  test('далеко от всего — сдвиг нулевой', () => {
    const snap = snapBox({ minX: 1.2, maxX: 2.2, minY: 1.2, maxY: 2.2 }, guides, 0.5, 0.05);
    expect(snap).toEqual({ dx: 0, dy: 0, x: null, y: null });
  });
});

describe('направляющие плана и центр объекта', () => {
  const plan = loadPlan('minimal.json');
  const object = plan.objects[0]!;

  test('объект не притягивается к самому себе, а к граням соседа и контуру — да', () => {
    const own = objectGuides(plan, new Set([object.id]));
    const all = objectGuides(plan, new Set());
    // Без исключения грани самого объекта попали бы в направляющие.
    expect(all.xs.length).toBeGreaterThan(own.xs.length);
    // Вершины контура — направляющие, кроме лежащих на оси стены: (0,8) и (10,8) — под w_north.
    expect(own.xs).toContain(0);
    expect(own.xs).toContain(10);
    expect(own.ys).toContain(0);
    expect(own.ys).not.toContain(8);
  });

  test('стена тянет гранью толщины, а не осью: «впритык» не значит «внутри стены»', () => {
    const wall = plan.walls[0]!; // w_north по y = 8, толщина 0,2: грани 7,9 и 8,1
    const guides = objectGuides(plan, new Set([object.id]));
    const half = wall.thickness_m / 2;
    expect(guides.ys).toContain(wall.from[1] - half);
    expect(guides.ys).toContain(wall.from[1] + half);
    expect(guides.ys).not.toContain(wall.from[1]);
    // Объект подходит изнутри: верхняя грань 7,87 ложится на 7,9, а не на ось 8,0.
    const depth = object.size_m[1];
    const centre: [number, number] = [5, 7.87 - depth / 2];
    const { centre: snapped } = snapObjectCentre({ ...object, rotation_deg: 0 }, centre, guides, null, 0.15);
    expect(snapped[1] + depth / 2).toBeCloseTo(wall.from[1] - half, 9);
  });

  test('вершины зон — направляющие, кроме лежащих на оси стены', () => {
    const guides = objectGuides(plan, new Set([object.id]));
    const wall = plan.walls[0]!;
    let counted = 0;
    for (const zone of plan.zones) {
      for (const vertex of zone.polygon) {
        if (vertex[1] === wall.from[1]) continue; // на оси w_north — внутри стены
        expect(guides.xs).toContain(vertex[0]);
        expect(guides.ys).toContain(vertex[1]);
        counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(0);
  });

  test('датчик на потолке и камера — не направляющие: мебель равняют по мебели (D-211)', () => {
    const rack = plan.objects[0]!;
    const type = plan.catalog.objectTypes.find((entry) => entry.id === rack.typeId)!;
    const ceiling = { ...type, id: 'ot_sensor', label: 'Датчик', occupiesFloor: false };
    const marker = { ...type, id: 'ot_marker', label: 'Разметка', physical: false };
    const withSensors: PlanDocument = {
      ...plan,
      catalog: { ...plan.catalog, objectTypes: [...plan.catalog.objectTypes, ceiling, marker] },
      objects: [
        rack,
        { ...rack, id: 'eq_sensor', typeId: 'ot_sensor', position: [8.3, 6.3], size_m: [0.12, 0.12] },
        { ...rack, id: 'eq_marker', typeId: 'ot_marker', position: [8.7, 6.7], size_m: [0.4, 0.4] },
      ],
    };
    const guides = objectGuides(withSensors, new Set());
    expect(guides.xs).not.toContain(8.3 - 0.06);
    expect(guides.xs).not.toContain(8.7 - 0.2);
    expect(guides.xs).toContain(rack.position[0] - rack.size_m[0] / 2);
  });

  test('скрытый слой не тянет', () => {
    const hiddenPlan: PlanDocument = {
      ...plan,
      layers: plan.layers.map((layer) => ({ ...layer, visible: false })),
    };
    const guides = objectGuides(hiddenPlan, new Set());
    const visible = objectGuides(plan, new Set());
    expect(guides.xs.length).toBeLessThan(visible.xs.length);
  });

  test('центр сдвигается так, что грань ложится на направляющую; при Alt слой просто не зовёт', () => {
    const guides = { xs: [4], ys: [] };
    const halfWidth = object.size_m[0] / 2;
    // Правая грань на 4.03 при центре 4.03 − halfWidth: притянется к 4.
    const centre: [number, number] = [4.03 - halfWidth, 2];
    const { centre: snapped, snap } = snapObjectCentre({ ...object, rotation_deg: 0 }, centre, guides, null, 0.1);
    expect(snapped[0] + halfWidth).toBeCloseTo(4, 9);
    expect(snapped[1]).toBe(2);
    expect(snap.x?.kind).toBe('guide');
  });
});

describe('вершина при рисовании (D-209)', () => {
  const plan = loadPlan('minimal.json');

  test('направляющие точки — все вершины плана, включая ось и грани стены', () => {
    const guides = pointGuides(plan);
    const wall = plan.walls[0]!;
    expect(guides.ys).toContain(wall.from[1]);
    expect(guides.ys).toContain(wall.from[1] - wall.thickness_m / 2);
    for (const vertex of plan.room.boundary) expect(guides.xs).toContain(vertex[0]);
    for (const zone of plan.zones) for (const vertex of zone.polygon) expect(guides.ys).toContain(vertex[1]);
  });

  test('зона на скрытом слое не даёт направляющих точке', () => {
    const hiddenPlan: PlanDocument = { ...plan, layers: plan.layers.map((layer) => ({ ...layer, visible: false })) };
    // В minimal.json зона z_client доходит до x = 7 — этой координаты нет ни у контура, ни у стен.
    expect(pointGuides(plan).xs).toContain(7);
    expect(pointGuides(hiddenPlan).xs).not.toContain(7);
  });

  test('ось перегородки — направляющая: конец новой перегородки найдёт начало старой', () => {
    const partition = { ...plan.walls[0]!, id: 'w_part', from: [3, 1] as [number, number], to: [3, 6] as [number, number] };
    const guides = pointGuides({ ...plan, walls: [...plan.walls, partition] });
    expect(guides.xs).toContain(3);
    expect(guides.ys).toContain(1);
    expect(guides.ys).toContain(6);
  });

  test('каждая координата идёт к ближайшей направляющей, иначе к сетке; вне допуска — как кликнули', () => {
    const guides = { xs: [10], ys: [8] };
    expect(snapPoint([9.94, 7.44], guides, 0.5, 0.1)).toEqual({
      point: [10, 7.5],
      x: { value: 10, delta: expect.closeTo(0.06, 9), kind: 'guide' },
      y: { value: 7.5, delta: expect.closeTo(0.06, 9), kind: 'grid' },
    });
    expect(snapPoint([9.7, 7.3], guides, 0.5, 0.1).point).toEqual([9.7, 7.3]);
  });
});

describe('что попадает в файл после привязки (D-211)', () => {
  test('координата от направляющей хранится до миллиметра, остальное — до сантиметра', () => {
    const guide = { value: 14.875, delta: 0.01, kind: 'guide' as const };
    expect(settle(14.875, guide)).toBe(14.875);
    expect(settle(14.875, null)).toBe(14.88);
    expect(settle(14.875, { value: 15, delta: 0.125, kind: 'grid' })).toBe(14.88);
    expect(settlePoint({ point: [14.875, 3.004], x: guide, y: null })).toEqual([14.875, 3]);
  });

  test('стеллаж у грани стены 14,875 остаётся на грани, а не в стене', () => {
    const plan = loadPlan('minimal.json');
    const object = plan.objects[0]!;
    const half = object.size_m[0] / 2;
    const { centre } = snapObjectCentre({ ...object, rotation_deg: 0 }, [14.875 - half - 0.01, 2], { xs: [14.875], ys: [] }, 0.5, 0.1);
    expect(centre[0] + half).toBe(14.875);
  });
});
