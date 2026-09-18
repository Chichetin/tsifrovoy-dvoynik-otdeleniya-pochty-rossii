/**
 * U05-ux: вложенные зоны не красятся дважды.
 *
 * Правило: каждую точку плана красит одна зона — самая глубокая со значением.
 * Родитель со значением красится с дырками там, где лежат его потомки со
 * своими значениями; потомок без значения остаётся под цветом родителя.
 */

import { describe, expect, test } from 'vitest';
import type { Zone } from '../../contracts/model';
import { paintRings, zonePaintRegions } from './zone-paint';

function zone(id: string, parentId: string | null, value: number | null): Zone {
  return {
    id,
    typeId: 'zt',
    name: id,
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    parentId,
    layerId: 'l_base',
    attributes: value === null ? {} : { v: value },
  };
}

const hasValue = (entry: Zone): boolean => typeof entry.attributes['v'] === 'number';
const shape = (regions: ReturnType<typeof zonePaintRegions>) =>
  regions.map((region) => [region.zone.id, region.holes.map((hole) => hole.id)]);

describe('zonePaintRegions', () => {
  test('плоские зоны красятся каждая целиком', () => {
    const zones = [zone('a', null, 1), zone('b', null, 2)];
    expect(shape(zonePaintRegions(zones, hasValue))).toEqual([
      ['a', []],
      ['b', []],
    ]);
  });

  test('родитель со значением вырезает потомков со значением', () => {
    const zones = [zone('p', null, 1), zone('c1', 'p', 2), zone('c2', 'p', 3)];
    expect(shape(zonePaintRegions(zones, hasValue))).toEqual([
      ['p', ['c1', 'c2']],
      ['c1', []],
      ['c2', []],
    ]);
  });

  test('потомок без значения не вырезается: его место красит родитель', () => {
    const zones = [zone('p', null, 1), zone('c', 'p', null)];
    expect(shape(zonePaintRegions(zones, hasValue))).toEqual([['p', []]]);
  });

  test('дырка — ближайший окрашенный потомок, через неокрашенного посредника', () => {
    const zones = [zone('p', null, 1), zone('m', 'p', null), zone('g', 'm', 5)];
    expect(shape(zonePaintRegions(zones, hasValue))).toEqual([
      ['p', ['g']],
      ['g', []],
    ]);
  });

  test('внук со значением вырезается из ребёнка, а не из деда', () => {
    const zones = [zone('p', null, 1), zone('c', 'p', 2), zone('g', 'c', 3)];
    expect(shape(zonePaintRegions(zones, hasValue))).toEqual([
      ['p', ['c']],
      ['c', ['g']],
      ['g', []],
    ]);
  });

  test('цикл родителей не вешает расчёт', () => {
    const zones = [zone('a', 'b', 1), zone('b', 'a', 2)];
    expect(zonePaintRegions(zones, hasValue)).toHaveLength(2);
  });

  test('потерянный родитель — зона считается корневой', () => {
    const zones = [zone('c', 'missing', 2)];
    expect(shape(zonePaintRegions(zones, hasValue))).toEqual([['c', []]]);
  });

  test('кольца заливки: контур зоны и контуры её дыр по порядку', () => {
    const parent = zone('p', null, 1);
    const child = { ...zone('c', 'p', 2), polygon: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]] as Zone['polygon'] };
    const [region] = zonePaintRegions([parent, child], hasValue);
    expect(region === undefined ? [] : paintRings(region)).toEqual([parent.polygon, child.polygon]);
  });
});
