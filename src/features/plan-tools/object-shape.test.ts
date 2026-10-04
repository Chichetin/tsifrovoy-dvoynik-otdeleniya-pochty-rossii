import { describe, expect, it } from 'vitest';
import type { Equipment, Polygon } from '../../contracts/model';
import { footprint } from '../../domain/geometry';
import { objectFromRing, reshapeObject } from './object-shape';
import { moveVertex, removeVertex } from './vertex-edit';

const desk: Equipment = {
  id: 'eq_1',
  typeId: 'ot_desk',
  label: 'Стол',
  position: [5, 5],
  size_m: [2, 1],
  rotation_deg: 0,
  base_m: 0,
  height_m: 0.75,
  zoneId: null,
  layerId: 'layer_equipment',
  attributes: {},
};

function expectRing(actual: Polygon, expected: Polygon): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    // Size and centre are stored to the millimetre: a vertex may drift by that much.
    expect(Math.abs(point[0] - expected[index]![0])).toBeLessThan(1.5e-3);
    expect(Math.abs(point[1] - expected[index]![1])).toBeLessThan(1.5e-3);
  });
}

describe('reshapeObject: контур на плане → size_m, position, outline (D-279)', () => {
  it('нетронутый след возвращает тот же габарит и центр', () => {
    const result = reshapeObject(desk, footprint(desk));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.size_m).toEqual([2, 1]);
    expect(result.object.position).toEqual([5, 5]);
    expectRing(footprint(result.object), footprint(desk));
  });

  it('вытянутая вершина растит габарит, двигает центр рамки, а остальные вершины стоят на месте', () => {
    // footprint прямоугольника: [4,4.5] [6,4.5] [6,5.5] [4,5.5]
    const ring = moveVertex(footprint(desk), 2, [7, 6]);
    const result = reshapeObject(desk, ring);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.size_m).toEqual([3, 1.5]);
    expect(result.object.position).toEqual([5.5, 5.25]);
    // Контур снова ровно в [-0.5, 0.5] — как требует контракт D-277.
    const xs = result.object.outline!.map((point) => point[0]);
    const ys = result.object.outline!.map((point) => point[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-0.5, 0.5, -0.5, 0.5]);
    expectRing(footprint(result.object), ring);
  });

  it('повёрнутый объект сохраняет поворот, а след совпадает с нарисованным', () => {
    const turned: Equipment = { ...desk, rotation_deg: 30 };
    const ring = moveVertex(footprint(turned), 0, [3, 3]);
    const result = reshapeObject(turned, ring);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.rotation_deg).toBe(30);
    expectRing(footprint(result.object), ring);
  });

  it('удалённая вершина даёт треугольник того же места', () => {
    const ring = removeVertex(footprint(desk), 2)!;
    const result = reshapeObject(desk, ring);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.outline).toHaveLength(3);
    expectRing(footprint(result.object), ring);
  });

  it('самопересечение и сплющенный контур отклоняются', () => {
    const crossed = moveVertex(footprint(desk), 1, [4, 6]);
    expect(reshapeObject(desk, crossed)).toEqual({ ok: false, reason: 'self-intersection' });
    const flat: Polygon = [
      [4, 5],
      [6, 5],
      [5, 5.05],
    ];
    expect(reshapeObject(desk, flat)).toEqual({ ok: false, reason: 'too-small' });
  });
});

describe('objectFromRing: нарисованный многоугольник → новый объект', () => {
  it('габарит — рамка, центр — её середина, поворот 0', () => {
    const ring: Polygon = [
      [1, 1],
      [4, 1],
      [4, 2],
      [2, 2],
      [2, 3],
      [1, 3],
    ];
    const result = objectFromRing({ ...desk, rotation_deg: 45 }, ring);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.rotation_deg).toBe(0);
    expect(result.object.size_m).toEqual([3, 2]);
    expect(result.object.position).toEqual([2.5, 2]);
    expect(result.object.outline).toEqual([
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0],
      [-0.166667, 0],
      [-0.166667, 0.5],
      [-0.5, 0.5],
    ]);
  });
});
