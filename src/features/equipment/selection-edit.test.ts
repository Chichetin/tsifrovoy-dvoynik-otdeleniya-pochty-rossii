import { expect, it } from 'vitest';
import type { Equipment } from '../../contracts/model';
import { PASTE_OFFSET_M, copyOffset, duplicateObjects, pasteObjects, repeatOffset } from './selection-edit';

const chair: Equipment = {
  id: 'eq_1',
  typeId: 'chair',
  label: '',
  position: [2, 3],
  size_m: [0.5, 0.5],
  rotation_deg: 0,
  base_m: 0,
  height_m: 0.9,
  zoneId: null,
  layerId: 'layer_furniture',
  attributes: {},
};

it('копию сдвинули — следующая встаёт от неё на то же смещение, ряд из трёх стульев', () => {
  const first = duplicateObjects([chair], new Set([chair.id]))[0]!;
  expect(first.position).toEqual([2 + PASTE_OFFSET_M[0], 3 + PASTE_OFFSET_M[1]]);
  const moved = { ...first, position: [3, 3] as [number, number] };
  const offset = repeatOffset(chair.position, moved.position);
  expect(offset).toEqual([1, 0]);
  expect(duplicateObjects([moved], new Set([chair.id, first.id]), offset)[0]!.position).toEqual([4, 3]);
});

it('копию вернули на оригинал — смещение снова по умолчанию', () => {
  expect(repeatOffset(chair.position, [2.01, 3])).toEqual(PASTE_OFFSET_M);
});

it('копия крупного объекта не ложится на оригинал: по X — ширина набора плюс зазор; малый и тонкий — прежнее смещение', () => {
  const window = { ...chair, id: 'eq_w', size_m: [1.6, 0.9] as [number, number] };
  const thin = { ...chair, id: 'eq_t', size_m: [2, 0.3] as [number, number] };
  expect(copyOffset([chair])).toEqual(PASTE_OFFSET_M);
  expect(copyOffset([thin])).toEqual(PASTE_OFFSET_M);
  expect(copyOffset([window])[0]).toBeCloseTo(1.7);
  expect(duplicateObjects([window], new Set([window.id]))[0]!.position).toEqual([3.7, 2.5]);
  // Вторая вставка подряд уходит вдвое дальше.
  expect(pasteObjects([window], new Set([window.id]), 2)[0]!.position).toEqual([5.4, 2]);
  // Набор из двух стульев по диагонали: 2,5 × 1,5 м — шире и глубже сдвига.
  const second = { ...chair, id: 'eq_2', position: [4, 4] as [number, number] };
  expect(copyOffset([chair, second])[0]).toBeCloseTo(2.5 + 0.1);
});
