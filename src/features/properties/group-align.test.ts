import { expect, it } from 'vitest';
import type { Equipment } from '../../contracts/model';
import { alignObjects, distributeObjects } from './group-align';

const bench = (id: string, position: [number, number], size_m: [number, number] = [1, 0.5]): Equipment => ({
  id,
  typeId: 'ot_bench',
  label: id,
  position,
  size_m,
  rotation_deg: 0,
  base_m: 0,
  height_m: 0.5,
  zoneId: null,
  layerId: 'l_base',
  attributes: {},
});

it('выравнивание по левому краю: грань у всех на самой левой, у повёрнутого — по габариту следа', () => {
  const turned = { ...bench('b', [5, 2], [2, 1]), rotation_deg: 90 }; // след 1 × 2, левая грань x = 4,5
  const [a, b, c] = alignObjects([bench('a', [3, 1]), turned, bench('c', [7, 4])], 'left');
  expect(a!.position[0]).toBe(3); // левая грань 2,5 — самая левая
  expect(b!.position[0]).toBe(3);
  expect(c!.position).toEqual([3, 4]);
});

it('«по верху» берёт наибольший Y (ось вверх), «по центру» — середину общего размаха', () => {
  const rows = [bench('a', [1, 1]), bench('b', [4, 3])];
  expect(alignObjects(rows, 'top').map((o) => o.position[1])).toEqual([3, 3]);
  expect(alignObjects(rows, 'centerX').map((o) => o.position[0])).toEqual([2.5, 2.5]);
});

it('равные промежутки: крайние на месте, средний — так, чтобы зазоры совпали; меньше трёх — без изменений', () => {
  // Порядок ответа — порядок входа. Грани: a −0,5…0,5, b (шириной 2) 2…4, c 11,5…12,5 → зазор по 4,5, b стоит на 5…7.
  const placed = distributeObjects([bench('a', [0, 0]), bench('c', [12, 0]), bench('b', [3, 0], [2, 0.5])], 0);
  expect(placed.map((o) => o.position[0])).toEqual([0, 12, 6]);
  const pair = [bench('a', [0, 0]), bench('b', [3, 0])];
  expect(distributeObjects(pair, 0)).toEqual(pair);
});
