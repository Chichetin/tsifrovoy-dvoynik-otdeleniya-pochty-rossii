import { describe, expect, it } from 'vitest';
import type { Equipment, Point, Wall } from '../../contracts/model';
import { intersects, isSimplePolygon, objectHitsWall, wallObstacles, wallPolygon, wallSpanPolygon } from './index';
const wall = (id: string, from: Point, to: Point, thickness_m = 0.2): Wall => ({ id, from, to, thickness_m, height_m: 3 });
const reverse = (w: Wall): Wall => ({ ...w, from: w.to, to: w.from });
describe('стык двух стен', () => {
  it('в прямом углу обе стены имеют общую диагональ вместо ступеньки; без взаимного наложения', () => {
    const a = wall('a', [0, 0], [4, 0]); const b = wall('b', [0, 0], [0, 3]); const walls = [a, b];
    const p = wallPolygon(a, walls); const q = wallPolygon(b, walls);
    expect(p).toEqual([[0.1, 0.1], [4, 0.1], [4, -0.1], [-0.1, -0.1]]);
    expect(q).toEqual([[-0.1, -0.1], [-0.1, 3], [0.1, 3], [0.1, 0.1]]);
    expect(intersects(p, q)).toBe(false); expect(isSimplePolygon(p)).toBe(true);
  });
  it('смена направления отрезков не меняет занятую геометрию и разные толщины сходятся', () => {
    const a = wall('a', [0, 0], [4, 0], 0.3); const b = wall('b', [0, 0], [0, 3], 0.1);
    const normal = wallPolygon(a, [a, b]); const reversed = wallPolygon(reverse(a), [reverse(a), reverse(b)]);
    for (const point of normal) expect(reversed).toContainEqual(point);
    const other = wallPolygon(b, [a, b]);
    expect(other).toContainEqual(normal[0]); expect(other).toContainEqual(normal[3]);
  });
  it('дверной пролёт сохраняет прямые торцы; угловой стык только на краю самой стены', () => {
    const a = wall('a', [0, 0], [4, 0]); const b = wall('b', [0, 0], [0, 3]);
    const parts = wallObstacles(a, [{ id: 'door', wallId: 'a', offset_m: 1, width_m: 1, kind: 'door', sill_m: 0, height_m: 2.1 }], { base_m: 0, top_m: 1 }, [a, b]);
    expect(parts[0]).toEqual([[0.1, 0.1], [1, 0.1], [1, -0.1], [-0.1, -0.1]]);
    expect(parts[1]).toEqual([[2, 0.1], [4, 0.1], [4, -0.1], [2, -0.1]]);
    expect(wallSpanPolygon(a, 1, 2, 0.02, [a, b])).toEqual([[1, 0.01], [2, 0.01], [2, -0.01], [1, -0.01]]);
  });
  it('проверка столкновений видит заполненный внешний угол', () => {
    const a = wall('a', [0, 0], [4, 0]); const b = wall('b', [0, 0], [0, 3]);
    const object: Equipment = { id: 'obj', typeId: 'type', label: 'Объект', position: [-0.07, -0.05], size_m: [0.02, 0.02], rotation_deg: 0, base_m: 0, height_m: 1, zoneId: null, layerId: 'base', attributes: {} };
    expect(objectHitsWall(object, a, [])).toBe(false);
    expect(objectHitsWall(object, a, [], [a, b]) || objectHitsWall(object, b, [], [a, b])).toBe(true);
  });
  it('T-стык, острый угол и разная высота не получают случайный длинный выступ', () => {
    const a = wall('a', [0, 0], [4, 0]); const b = wall('b', [0, 0], [0, 3]); const c = wall('c', [0, 0], [-4, 0]);
    expect(wallPolygon(a, [a, b, c])).toEqual(wallPolygon(a));
    expect(wallPolygon(a, [a, { ...b, height_m: 2 }])).toEqual(wallPolygon(a));
    expect(wallPolygon(a, [a, wall('sharp', [0, 0], [4, 0.05])])).toEqual(wallPolygon(a));
    const short = wall('short', [0, 0], [0, 0.1]);
    expect(wallPolygon(a, [a, short])).toEqual(wallPolygon(a));
    expect(wallPolygon(short, [a, short])).toEqual(wallPolygon(short));
  });
});

it('короткий торцевой остаток перед дверью обрезается в простой полигон без бантика', () => {
  const a = wall('a', [0, 0], [4, 0]); const b = wall('b', [0, 0], [0, 3]);
  const parts = wallObstacles(a, [{ id: 'door', wallId: 'a', offset_m: 0.05, width_m: 1, kind: 'door', sill_m: 0, height_m: 2.1 }], { base_m: 0, top_m: 1 }, [a, b]);
  expect(parts).toHaveLength(2);
  for (const polygon of parts) expect(isSimplePolygon(polygon)).toBe(true);
  expect(parts[0]!.every(([x]) => x <= 0.05 + 1e-6)).toBe(true);
});
