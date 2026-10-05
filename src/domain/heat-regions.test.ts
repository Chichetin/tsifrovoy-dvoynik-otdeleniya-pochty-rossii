/**
 * U05: тепловой слой не красит одну точку дважды.
 *
 * Проверяется не картинка, а площадь: сумма закрашенных областей должна
 * совпадать с площадью, накрытой зонами, у которых есть значение. Если
 * вложенная зона красится и сама, и через родителя, сумма окажется больше.
 */

import { describe, expect, test } from 'vitest';
import type { Attributes, Polygon, Zone } from '../contracts/model';
import { polygonArea, signedArea } from './geometry';
import { heatRegions } from './heat-regions';

const ATTRIBUTE = 'loadPercent';

function zone(id: string, polygon: Polygon, parentId: string | null, attributes: Attributes): Zone {
  return { id, typeId: 'zt_client', name: id, polygon, parentId, layerId: 'l_base', attributes };
}

function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Площадь области с дырами: внешние кольца плюс, дыры минус. */
function regionArea(rings: Polygon[]): number {
  return rings.reduce((total, ring) => total + (signedArea(ring) > 0 ? 1 : -1) * polygonArea(ring), 0);
}

function paintedArea(zones: Zone[]): number {
  return heatRegions(zones, ATTRIBUTE).reduce(
    (total, region) => total + regionArea(region.rings),
    0,
  );
}

describe('heatRegions', () => {
  test('две несвязанные зоны красятся целиком', () => {
    const zones = [
      zone('a', rect(0, 0, 2, 2), null, { [ATTRIBUTE]: 40 }),
      zone('b', rect(5, 0, 7, 2), null, { [ATTRIBUTE]: 60 }),
    ];

    const regions = heatRegions(zones, ATTRIBUTE);

    expect(regions.map((region) => region.zoneId)).toEqual(['a', 'b']);
    expect(paintedArea(zones)).toBeCloseTo(8, 6);
  });

  test('вложенная зона не закрашивается дважды: площадь равна площади родителя', () => {
    const zones = [
      zone('parent', rect(0, 0, 10, 10), null, { [ATTRIBUTE]: 65 }),
      zone('child', rect(2, 2, 4, 4), 'parent', { [ATTRIBUTE]: 70 }),
    ];

    // Родитель 100 м², ребёнок 4 м²: сумма закрашенного — ровно 100, не 104.
    expect(paintedArea(zones)).toBeCloseTo(100, 6);
  });

  test('у родителя под вложенной зоной появляется дыра', () => {
    const zones = [
      zone('parent', rect(0, 0, 10, 10), null, { [ATTRIBUTE]: 65 }),
      zone('child', rect(2, 2, 4, 4), 'parent', { [ATTRIBUTE]: 70 }),
    ];

    const parent = heatRegions(zones, ATTRIBUTE).find((region) => region.zoneId === 'parent');

    expect(parent?.rings).toHaveLength(2);
    expect(regionArea(parent?.rings ?? [])).toBeCloseTo(96, 6);
  });

  test('внешнее кольцо обходится против часовой, дыра — по часовой', () => {
    const zones = [
      zone('parent', rect(0, 0, 10, 10), null, { [ATTRIBUTE]: 65 }),
      zone('child', rect(2, 2, 4, 4), 'parent', { [ATTRIBUTE]: 70 }),
    ];

    const parent = heatRegions(zones, ATTRIBUTE).find((region) => region.zoneId === 'parent');
    const [outer, hole] = parent?.rings ?? [];

    expect(signedArea(outer ?? [])).toBeGreaterThan(0);
    expect(signedArea(hole ?? [])).toBeLessThan(0);
  });

  test('зона без значения не красится и не вырезает область родителя', () => {
    const zones = [
      zone('parent', rect(0, 0, 10, 10), null, { [ATTRIBUTE]: 65 }),
      zone('child', rect(2, 2, 4, 4), 'parent', {}),
    ];

    const regions = heatRegions(zones, ATTRIBUTE);

    expect(regions.map((region) => region.zoneId)).toEqual(['parent']);
    expect(paintedArea(zones)).toBeCloseTo(100, 6);
  });

  test('значение внука выигрывает у значения ребёнка и родителя', () => {
    const zones = [
      zone('parent', rect(0, 0, 10, 10), null, { [ATTRIBUTE]: 10 }),
      zone('child', rect(0, 0, 6, 6), 'parent', { [ATTRIBUTE]: 20 }),
      zone('grand', rect(0, 0, 3, 3), 'child', { [ATTRIBUTE]: 30 }),
    ];

    const regions = heatRegions(zones, ATTRIBUTE);
    const area = (id: string): number =>
      regionArea(regions.find((region) => region.zoneId === id)?.rings ?? []);

    // 100 − 36 = 64 у родителя, 36 − 9 = 27 у ребёнка, 9 у внука: вместе 100.
    expect(area('parent')).toBeCloseTo(64, 6);
    expect(area('child')).toBeCloseTo(27, 6);
    expect(area('grand')).toBeCloseTo(9, 6);
    expect(paintedArea(zones)).toBeCloseTo(100, 6);
  });

  test('зона, полностью накрытая вложенной, не закрашивается вовсе', () => {
    const zones = [
      zone('parent', rect(0, 0, 4, 4), null, { [ATTRIBUTE]: 65 }),
      zone('child', rect(0, 0, 4, 4), 'parent', { [ATTRIBUTE]: 70 }),
    ];

    const regions = heatRegions(zones, ATTRIBUTE);

    expect(regions.map((region) => region.zoneId)).toEqual(['child']);
    expect(paintedArea(zones)).toBeCloseTo(16, 6);
  });

  test('цикл в parentId не уводит в бесконечность', () => {
    const zones = [
      zone('a', rect(0, 0, 4, 4), 'b', { [ATTRIBUTE]: 10 }),
      zone('b', rect(0, 0, 4, 4), 'a', { [ATTRIBUTE]: 20 }),
    ];

    expect(() => heatRegions(zones, ATTRIBUTE)).not.toThrow();
  });

  test('нечисловое значение атрибута зону не красит', () => {
    const zones = [
      zone('a', rect(0, 0, 2, 2), null, { [ATTRIBUTE]: 'много' }),
      zone('b', rect(5, 0, 7, 2), null, { [ATTRIBUTE]: null }),
    ];

    expect(heatRegions(zones, ATTRIBUTE)).toEqual([]);
  });
});
