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
import { objectGuides, snapAxis, snapBox, snapObjectCentre } from './index';

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
    for (const vertex of plan.room.boundary) {
      expect(own.xs).toContain(vertex[0]);
      expect(own.ys).toContain(vertex[1]);
    }
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
