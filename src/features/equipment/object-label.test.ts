import { describe, expect, test } from 'vitest';
import type { Equipment, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { LABEL_MIN_WIDTH_PX, objectLabel } from './object-label';

function object(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: 'eq_1',
    typeId: 'ot_parcel_rack',
    label: 'Стеллаж посылок',
    position: [5, 5],
    size_m: [2, 1],
    rotation_deg: 0,
    base_m: 0,
    height_m: 2,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...overrides,
  };
}

const viewport: Viewport = { origin: [0, 0], scale: 40 };

describe('подпись объекта на холсте', () => {
  test('широкий объект подписан в центре своего следа, без поворота', () => {
    const label = objectLabel(object({ rotation_deg: 37 }), viewport);
    expect(label).not.toBeNull();
    expect(label?.text).toBe('Стеллаж посылок');
    const [x, y] = modelToScreen([5, 5], viewport);
    expect(label?.x).toBe(x);
    expect(label?.y).toBe(y);
    expect(label?.width).toBe(104);
    // 40 px высоты вмещают две строки.
    expect(label?.lines).toBe(2);
  });

  test('ширина берётся по длинной стороне: вытянутый по Y объект подписан так же', () => {
    expect(objectLabel(object({ size_m: [1, 2] }), viewport)?.width).toBe(104);
  });

  test('низкий объект — одна строка', () => {
    expect(objectLabel(object({ size_m: [2, 0.5] }), viewport)?.lines).toBe(1);
  });

  test('маленький объект без подписи, пока масштаб не даст места', () => {
    const chair = object({ size_m: [0.6, 0.6] });
    expect(objectLabel(chair, viewport)).toBeNull();
    expect(objectLabel(chair, { origin: [0, 0], scale: LABEL_MIN_WIDTH_PX / 0.6 })).not.toBeNull();
  });

  test('пустая подпись — нет текста', () => {
    expect(objectLabel(object({ label: '  ' }), viewport)).toBeNull();
  });
});
