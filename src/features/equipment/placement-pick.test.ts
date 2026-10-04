import { expect, it } from 'vitest';
import type { Equipment, PlanDocument } from '../../contracts/model';
import { findPlacementPick } from './placement-pick';

const box = (id: string, typeId: string, position: [number, number], layerId = 'l_base'): Equipment => ({
  id,
  typeId,
  label: id,
  position,
  size_m: [1, 1],
  rotation_deg: 0,
  base_m: 0,
  height_m: 1,
  zoneId: null,
  layerId,
  attributes: {},
});

const plan = {
  layers: [
    { id: 'l_base', visible: true },
    { id: 'l_hidden', visible: false },
  ],
  objects: [box('a', 'ot_a', [0, 0]), box('b', 'ot_b', [0.5, 0]), box('h', 'ot_a', [5, 0], 'l_hidden')],
} as unknown as PlanDocument;

it('указатель: верхний из наложенных, промах в пределах 8 px, тип сужает выбор, скрытый слой не в счёт', () => {
  expect(findPlacementPick(plan, null, [0.4, 0], 40)?.id).toBe('b'); // оба под точкой — выигрывает верхний
  expect(findPlacementPick(plan, 'ot_a', [0.4, 0], 40)?.id).toBe('a');
  expect(findPlacementPick(plan, null, [1 + 0.15, 0], 40)?.id).toBe('b'); // 6 px от грани при 40 px/м
  expect(findPlacementPick(plan, null, [1 + 0.3, 0], 40)).toBeNull(); // 12 px — мимо
  expect(findPlacementPick(plan, null, [5, 0], 40)).toBeNull();
});
