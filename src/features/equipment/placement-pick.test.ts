import { describe, expect, test } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { PlanDocument, Point } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { findPlacementPick } from './placement-pick';

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const plan: PlanDocument = parsed.value;

describe('выбор существующего объекта под инструментом установки', () => {
  test('клик внутри видимого объекта того же типа выбирает его', () => {
    expect(findPlacementPick(plan, 'ot_workplace', [2, 2], 48)?.id).toBe('eq_work_1');
  });

  test.each([
    { scale: 40, near: [2.89, 2] as Point, far: [2.91, 2] as Point },
    { scale: 80, near: [2.795, 2] as Point, far: [2.805, 2] as Point },
  ])('допуск равен 8 экранным пикселям при масштабе $scale', ({ scale, near, far }) => {
    expect(findPlacementPick(plan, 'ot_workplace', near, scale)?.id).toBe('eq_work_1');
    expect(findPlacementPick(plan, 'ot_workplace', far, scale)).toBeNull();
  });

  test('другой тип и скрытый слой не перехватывают установку', () => {
    expect(findPlacementPick(plan, 'ot_bench', [2, 2], 48)).toBeNull();

    const hidden: PlanDocument = {
      ...plan,
      layers: plan.layers.map((layer) => ({ ...layer, visible: false })),
    };
    expect(findPlacementPick(hidden, 'ot_workplace', [2, 2], 48)).toBeNull();
  });

  test('при равной близости выбирается верхний объект из конца массива', () => {
    const first = plan.objects[0];
    if (first === undefined) throw new Error('В фикстуре нет объекта');
    const overlapping: PlanDocument = {
      ...plan,
      objects: [first, { ...first, id: 'eq_work_top' }],
    };

    expect(findPlacementPick(overlapping, 'ot_workplace', [2, 2], 48)?.id).toBe(
      'eq_work_top',
    );
  });
});
