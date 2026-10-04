import { describe, expect, test } from 'vitest';
import type { Zone } from '../../contracts/model';
import { orderZonesByNesting } from './zone-tree';

/** Зона без геометрии: порядок строк считается по `id`/`parentId`, полигон здесь не участвует. */
function zone(id: string, parentId?: string): Zone {
  return {
    id,
    name: id,
    typeId: 'zt_client',
    layerId: 'l_zones',
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    attributes: {},
    ...(parentId === undefined ? {} : { parentId }),
  } as Zone;
}

const order = (zones: Zone[]): string[] => orderZonesByNesting(zones).map((row) => row.zone.id);
const depths = (zones: Zone[]): number[] => orderZonesByNesting(zones).map((row) => row.depth);

describe('порядок зон по вложенности', () => {
  test('вложенная зона идёт сразу под родителем, а не там, где лежала в файле', () => {
    const zones = [zone('a'), zone('b'), zone('a1', 'a')];

    expect(order(zones)).toEqual(['a', 'a1', 'b']);
    expect(depths(zones)).toEqual([0, 1, 0]);
  });

  test('вложенность считается на любую глубину', () => {
    const zones = [zone('a'), zone('a1', 'a'), zone('a1x', 'a1')];

    expect(depths(zones)).toEqual([0, 1, 2]);
  });

  test('порядок соседей — тот же, что в плане', () => {
    const zones = [zone('b'), zone('a'), zone('b2', 'b'), zone('b1', 'b')];

    expect(order(zones)).toEqual(['b', 'b2', 'b1', 'a']);
  });

  test('ссылка на несуществующего родителя делает зону верхнеуровневой', () => {
    const zones = [zone('a', 'нет-такой')];

    expect(order(zones)).toEqual(['a']);
    expect(depths(zones)).toEqual([0]);
  });

  test('зона внутри самой себя не теряется и не зацикливает обход', () => {
    const zones = [zone('a', 'a'), zone('b')];

    expect(order(zones)).toEqual(['a', 'b']);
    expect(depths(zones)).toEqual([0, 0]);
  });

  test('цикл из двух зон показывается целиком, верхним уровнем', () => {
    const zones = [zone('a', 'b'), zone('b', 'a')];

    expect(order(zones)).toEqual(['a', 'b']);
    expect(depths(zones)).toEqual([0, 0]);
  });

  test('ни одна зона не теряется и не дублируется', () => {
    const zones = [zone('a'), zone('a1', 'a'), zone('b', 'x'), zone('c', 'c'), zone('a2', 'a')];

    expect(order(zones).sort()).toEqual(['a', 'a1', 'a2', 'b', 'c']);
  });

  test('пустой план даёт пустую таблицу', () => {
    expect(orderZonesByNesting([])).toEqual([]);
  });
});
