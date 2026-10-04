import { expect, it } from 'vitest';
import type { Equipment, PlanDocument } from '../../contracts/model';
import type { EditorSession } from '../../contracts/ui';
import { segmentReadout, selectionReadout } from './canvas-status';

const crate = (id: string, size_m: [number, number]): Equipment => ({
  id,
  typeId: 'ot_rack',
  label: id,
  position: [5, 5],
  size_m,
  rotation_deg: 0,
  base_m: 0,
  height_m: 1,
  zoneId: null,
  layerId: 'l_base',
  attributes: {},
});

const plan = {
  objects: [crate('eq_1', [2, 1]), crate('eq_2', [1, 1])],
  zones: [{ id: 'z_1', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
} as unknown as PlanDocument;

const session = (over: Partial<EditorSession>): EditorSession => ({ selection: null, ...over }) as EditorSession;

it('отрезок: длина в метрах, угол против часовой от оси X при оси Y вверх', () => {
  expect(segmentReadout([1, 1], [4, 5])).toMatchObject({ length_m: 5 });
  expect(segmentReadout([0, 0], [0, 2])).toEqual({ length_m: 2, angle_deg: 90 });
  expect(segmentReadout([0, 0], [-1, -1])?.angle_deg).toBeCloseTo(225);
  expect(segmentReadout([2, 2], [2, 2])).toBeNull();
});

it('выделение: группа объектов даёт число и сумму площадей, зона — свою площадь', () => {
  expect(selectionReadout(plan, session({ selected: new Set(['eq_1', 'eq_2']) }))).toEqual({
    kind: 'object',
    count: 2,
    area_m2: 3,
  });
  expect(selectionReadout(plan, session({ selection: { kind: 'zone', id: 'z_1' } }))).toEqual({
    kind: 'zone',
    count: 1,
    area_m2: 12,
  });
  expect(selectionReadout(plan, session({ selection: { kind: 'wall', id: 'w_1' } }))).toBeNull();
});
