import { describe, expect, test } from 'vitest';
import type { Equipment, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { LABEL_MIN_WIDTH_PX, objectLabel, planDisplayLabel } from './object-label';

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
  test('бирка со значком оставляет две строки для номера низкого предмета', () => {
    const rack = object({ size_m: [1.2, 0.5], label: 'Стеллаж посылок 3' });
    expect(objectLabel(rack, { origin: [0, 0], scale: 51 }, 24)?.lines).toBe(2);
  });
  test('если значок не оставляет читаемой ширины, подпись скрывается до увеличения', () => {
    expect(objectLabel(object({ size_m: [1.2, 0.5] }), { ...viewport, scale: 32 }, 20)).toBeNull();
  });
  test('на малом масштабе номер стеллажа сохраняется, пользовательское имя не заменяется', () => {
    const rack = object({ size_m: [1.2, 0.5], label: 'Стеллаж посылок 12' });
    expect(objectLabel(rack, viewport, 20)?.text).toBe('Посылки 12');
    expect(objectLabel(rack, { ...viewport, scale: 80 }, 20)?.text).toBe(rack.label);
    expect(rack.label).toBe('Стеллаж посылок 12');
    expect(objectLabel({ ...rack, label: 'Архив 12' }, viewport, 20)?.text).toBe('Архив 12');
  });
  test('номер рабочего места остаётся в короткой подписи, полное имя остаётся в данных', () => {
    const workplace = object({ typeId: 'ot_workplace', label: 'Рабочее место оператора 3' });
    expect(planDisplayLabel(workplace)).toBe('Рабочее место 3');
    expect(objectLabel(workplace, viewport)?.text).toBe('Рабочее место 3');
    expect(workplace.label).toBe('Рабочее место оператора 3');
  });
  test('широкий объект подписан в центре своего следа, без поворота', () => {
    const label = objectLabel(object(), viewport);
    expect(label).not.toBeNull();
    expect(label?.text).toBe('Стеллаж посылок');
    const [x, y] = modelToScreen([5, 5], viewport);
    expect(label?.x).toBe(x);
    expect(label?.y).toBe(y);
    expect(label?.width).toBe(104);
    // 40 px высоты вмещают две строки.
    expect(label?.lines).toBe(2);
  });

  test('поворот на 90° делает след широким: подпись снова горизонтальна', () => {
    const label = objectLabel(object({ size_m: [1, 2], rotation_deg: 90 }), viewport);
    expect(label?.width).toBe(104);
    expect(label?.rotation).toBe(0);
  });

  test('объект «на торце» подписан вдоль себя, а не оставлен без имени', () => {
    // Стол, вытянутый по Y: поперёк 1 м — горизонтальной подписи не хватит.
    const upright = objectLabel(object({ size_m: [1, 2] }), viewport);
    expect(upright).not.toBeNull();
    expect(upright?.rotation).toBe(90);
    // Ширина бирки — по длинной стороне, вдоль которой она и идёт.
    expect(upright?.width).toBe(104);

    // Тот же стол, повёрнутый инструментом: результат тот же.
    const turned = objectLabel(object({ size_m: [2, 1], rotation_deg: 90 }), viewport);
    expect(turned?.rotation).toBe(90);
    expect(turned?.width).toBe(104);
  });

  test('подпись никогда не идёт вверх ногами', () => {
    for (const rotation_deg of [0, 45, 90, 135, 180, 225, 270, 315, -120, 400]) {
      const label = objectLabel(object({ size_m: [1, 2], rotation_deg }), viewport);
      if (label === null) continue;
      expect(label.rotation).toBeGreaterThan(-90);
      expect(label.rotation).toBeLessThanOrEqual(90);
    }
  });

  test('повёрнутый в разные стороны стеллаж подписан одинаково', () => {
    const left = objectLabel(object({ size_m: [1, 2], rotation_deg: 90 }), viewport);
    const right = objectLabel(object({ size_m: [1, 2], rotation_deg: 270 }), viewport);
    expect(left?.rotation).toBe(right?.rotation);
  });

  test('узкий по обеим сторонам объект подписи по-прежнему не получает', () => {
    expect(objectLabel(object({ size_m: [0.5, 0.9] }), viewport)).toBeNull();
  });

  test('повёрнутая подпись держится центра объекта', () => {
    const label = objectLabel(object({ size_m: [1, 2], position: [3, 7] }), viewport);
    const [x, y] = modelToScreen([3, 7], viewport);
    expect(label?.x).toBe(x);
    expect(label?.y).toBe(y);
  });

  test('низкий объект — одна строка', () => {
    expect(objectLabel(object({ size_m: [2, 0.5] }), viewport)?.lines).toBe(1);
  });

  test('маленький объект без подписи, пока масштаб не даст места', () => {
    const chair = object({ size_m: [0.6, 0.6] });
    expect(objectLabel(chair, viewport)).toBeNull();
    expect(objectLabel(chair, { origin: [0, 0], scale: LABEL_MIN_WIDTH_PX / 0.6 + 1 })).not.toBeNull();
  });

  test('пустая подпись — нет текста', () => {
    expect(objectLabel(object({ label: '  ' }), viewport)).toBeNull();
  });
});
