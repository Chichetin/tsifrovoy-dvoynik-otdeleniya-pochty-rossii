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

  test('запертый видимый слой не мешает выбрать существующий объект', () => {
    const locked: PlanDocument = {
      ...plan,
      layers: plan.layers.map((layer) => ({ ...layer, locked: true })),
    };

    expect(findPlacementPick(locked, 'ot_workplace', [2, 2], 48)?.id).toBe('eq_work_1');
  });

  test('попадание считается по повёрнутому следу объекта', () => {
    const first = plan.objects[0];
    if (first === undefined) throw new Error('В фикстуре нет объекта');
    const rotated: PlanDocument = {
      ...plan,
      objects: [{ ...first, position: [0, 0], size_m: [2, 1], rotation_deg: 45 }],
    };

    expect(findPlacementPick(rotated, first.typeId, [0.65, -0.65], 100)?.id).toBe(first.id);
  });

  test('из нескольких кандидатов в допуске выбирается ближайший, не последний', () => {
    const first = plan.objects[0];
    if (first === undefined) throw new Error('В фикстуре нет объекта');
    const candidates: PlanDocument = {
      ...plan,
      objects: [
        { ...first, id: 'eq_near', position: [0, 0], size_m: [0.1, 0.1] },
        { ...first, id: 'eq_far', position: [0.15, 0], size_m: [0.1, 0.1] },
      ],
    };

    expect(findPlacementPick(candidates, first.typeId, [0.07, 0], 100)?.id).toBe('eq_near');
  });

  test('ровно 8 px входят в допуск, больше — уже постановка', () => {
    const first = plan.objects[0];
    if (first === undefined) throw new Error('В фикстуре нет объекта');
    const square: PlanDocument = {
      ...plan,
      objects: [{ ...first, position: [0, 0], size_m: [2, 2] }],
    };

    expect(findPlacementPick(square, first.typeId, [2, 0], 8)?.id).toBe(first.id);
    expect(findPlacementPick(square, first.typeId, [2.001, 0], 8)).toBeNull();
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
