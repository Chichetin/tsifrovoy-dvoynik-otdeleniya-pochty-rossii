/**
 * U07: правки над набором объектов — сдвиг стрелками, копирование и попадание
 * в рамку выделения.
 *
 * Все ожидания — в метрах мира по D-010 (Y вверх). Экрана здесь нет: сдвиг,
 * который верен на одном масштабе, верен на любом.
 */

import { describe, expect, test } from 'vitest';
import type { Equipment, Id } from '../../contracts/model';
import {
  MARQUEE_MIN_SIDE_M,
  NUDGE_FINE_STEP_M,
  NUDGE_STEP_M,
  PASTE_OFFSET_M,
  arrowDelta,
  marqueeHits,
  marqueeRect,
  moveObjects,
  nextObjectId,
  pasteObjects,
} from './selection-edit';

function object(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: 'eq_1',
    typeId: 'ot_parcel_rack',
    label: 'Стеллаж',
    position: [5, 5],
    size_m: [2, 1],
    rotation_deg: 0,
    base_m: 0,
    height_m: 2,
    zoneId: 'z_client',
    layerId: 'l_base',
    attributes: { condition: 'исправно' },
    ...overrides,
  };
}

describe('arrowDelta', () => {
  test('стрелка вверх идёт по +Y модели, вниз — по −Y', () => {
    expect(arrowDelta('ArrowUp', false)).toEqual([0, NUDGE_STEP_M]);
    expect(arrowDelta('ArrowDown', false)).toEqual([0, -NUDGE_STEP_M]);
  });

  test('влево и вправо идут по X', () => {
    expect(arrowDelta('ArrowLeft', false)).toEqual([-NUDGE_STEP_M, 0]);
    expect(arrowDelta('ArrowRight', false)).toEqual([NUDGE_STEP_M, 0]);
  });

  test('Shift даёт мелкий шаг, и он меньше обычного', () => {
    expect(arrowDelta('ArrowRight', true)).toEqual([NUDGE_FINE_STEP_M, 0]);
    expect(NUDGE_FINE_STEP_M).toBeLessThan(NUDGE_STEP_M);
  });

  test('не стрелка — не сдвиг', () => {
    expect(arrowDelta('Enter', false)).toBeNull();
    expect(arrowDelta('a', false)).toBeNull();
    expect(arrowDelta('Delete', true)).toBeNull();
  });
});

describe('moveObjects', () => {
  test('весь набор уезжает на один и тот же вектор', () => {
    const moved = moveObjects(
      [object({ id: 'eq_1', position: [1, 1] }), object({ id: 'eq_2', position: [4, 2.5] })],
      [0.5, -0.5],
    );
    expect(moved.map((item) => item.position)).toEqual([
      [1.5, 0.5],
      [4.5, 2],
    ]);
  });

  test('позиция округляется до сантиметра, как у перетаскивания мышью', () => {
    const [moved] = moveObjects([object({ position: [1.004, 2.006] })], [0, 0]);
    expect(moved?.position).toEqual([1, 2.01]);
  });

  test('мелкий шаг не теряется в округлении', () => {
    const delta = arrowDelta('ArrowRight', true);
    if (delta === null) throw new Error('стрелка вправо обязана давать сдвиг');
    const [moved] = moveObjects([object({ position: [1, 1] })], delta);
    expect(moved?.position).toEqual([1 + NUDGE_FINE_STEP_M, 1]);
  });

  test('кроме позиции ничего не меняется', () => {
    const source = object();
    const [moved] = moveObjects([source], [1, 0]);
    expect(moved).toEqual({ ...source, position: [6, 5] });
  });

  test('пустой набор — пустой результат', () => {
    expect(moveObjects([], [1, 1])).toEqual([]);
  });
});

describe('nextObjectId', () => {
  test('первый свободный номер', () => {
    expect(nextObjectId(new Set(['eq_1', 'eq_2']))).toBe('eq_3');
  });

  test('дыра в нумерации занимается', () => {
    expect(nextObjectId(new Set(['eq_1', 'eq_3']))).toBe('eq_2');
  });

  test('удалённый id (D-156) минуется', () => {
    // На плане пусто, но eq_1 и eq_2 были удалены в этой сессии: put с ними
    // стор отклонит ID_REUSED.
    expect(nextObjectId(new Set(['eq_1', 'eq_2']))).toBe('eq_3');
  });
});

describe('pasteObjects', () => {
  test('копия получает свежий id и смещение', () => {
    const [copy] = pasteObjects([object({ id: 'eq_1', position: [3, 3] })], new Set<Id>(['eq_1']));
    expect(copy?.id).toBe('eq_2');
    expect(copy?.position).toEqual([3 + PASTE_OFFSET_M[0], 3 + PASTE_OFFSET_M[1]]);
  });

  test('копии одного набора не делят id между собой', () => {
    const copies = pasteObjects(
      [object({ id: 'eq_1' }), object({ id: 'eq_2' }), object({ id: 'eq_3' })],
      new Set<Id>(['eq_1', 'eq_2', 'eq_3']),
    );
    expect(copies.map((item) => item.id)).toEqual(['eq_4', 'eq_5', 'eq_6']);
  });

  test('вторая вставка подряд уходит вдвое дальше первой', () => {
    const source = [object({ id: 'eq_1', position: [3, 3] })];
    const first = pasteObjects(source, new Set<Id>(['eq_1']), 1);
    const second = pasteObjects(source, new Set<Id>(['eq_1', 'eq_2']), 2);
    expect(first[0]?.position).toEqual([3.5, 2.5]);
    expect(second[0]?.position).toEqual([4, 2]);
    expect(second[0]?.id).toBe('eq_3');
  });

  test('копия не наследует зону: её пересчитает object.put по месту', () => {
    const [copy] = pasteObjects([object({ zoneId: 'z_client' })], new Set<Id>(['eq_1']));
    expect(copy?.zoneId).toBeNull();
  });

  test('тип, подпись, размер, поворот и атрибуты копируются', () => {
    const source = object({ rotation_deg: 37, size_m: [1.2, 0.6], label: 'Стеллаж №3' });
    const [copy] = pasteObjects([source], new Set<Id>(['eq_1']));
    expect(copy?.typeId).toBe(source.typeId);
    expect(copy?.label).toBe('Стеллаж №3');
    expect(copy?.size_m).toEqual([1.2, 0.6]);
    expect(copy?.rotation_deg).toBe(37);
    expect(copy?.attributes).toEqual(source.attributes);
    expect(copy?.layerId).toBe(source.layerId);
  });
});

describe('marqueeRect', () => {
  test('рамка справа налево и снизу вверх — та же рамка', () => {
    expect(marqueeRect([4, 3], [1, 1])).toEqual(marqueeRect([1, 1], [4, 3]));
  });

  test('углы нормализованы', () => {
    expect(marqueeRect([4, 3], [1, 1])).toEqual([
      [1, 1],
      [4, 1],
      [4, 3],
      [1, 3],
    ]);
  });
});

describe('marqueeHits', () => {
  const rack = object({ id: 'eq_1', position: [2, 2], size_m: [1, 1], rotation_deg: 0 });
  const bench = object({ id: 'eq_2', position: [6, 2], size_m: [1, 1], rotation_deg: 0 });

  test('объект целиком внутри рамки выделен', () => {
    expect(marqueeHits([rack, bench], [0, 0], [4, 4])).toEqual(['eq_1']);
  });

  test('достаточно задеть объект краем рамки', () => {
    // Рамка накрывает только правую четверть следа стеллажа (2.25 … 3).
    expect(marqueeHits([rack, bench], [2.25, 1], [3, 3])).toEqual(['eq_1']);
  });

  test('рамка вокруг всего плана берёт всё', () => {
    expect(marqueeHits([rack, bench], [-1, -1], [10, 10])).toEqual(['eq_1', 'eq_2']);
  });

  test('рамка мимо не берёт ничего', () => {
    expect(marqueeHits([rack, bench], [8, 8], [9, 9])).toEqual([]);
  });

  test('клик без протягивания — не рамка', () => {
    const tiny = MARQUEE_MIN_SIDE_M / 2;
    expect(marqueeHits([rack], [2, 2], [2 + tiny, 2 + tiny])).toEqual([]);
  });

  test('считается повёрнутый след, а не габарит по осям', () => {
    // Длинная стойка, повёрнутая на 315° (против часовой на 45°, D-010): её
    // угол уходит в рамку, центр остаётся снаружи.
    const turned = object({ id: 'eq_3', position: [5, 5], size_m: [4, 0.4], rotation_deg: 315 });
    expect(marqueeHits([turned], [6, 6], [7, 7])).toEqual(['eq_3']);
    // Та же рамка и тот же объект без поворота — мимо.
    expect(marqueeHits([{ ...turned, rotation_deg: 0 }], [6, 6], [7, 7])).toEqual([]);
  });

  test('порядок результата — порядок объектов в плане', () => {
    expect(marqueeHits([bench, rack], [-1, -1], [10, 10])).toEqual(['eq_2', 'eq_1']);
  });
});
