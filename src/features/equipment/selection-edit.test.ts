import { expect, it } from 'vitest';
import type { Equipment } from '../../contracts/model';
import { PASTE_OFFSET_M, duplicateObjects, repeatOffset } from './selection-edit';

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
