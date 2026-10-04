/**
 * U04: gesture arithmetic for rotating and resizing equipment.
 *
 * Every function takes world metres. The screen never enters here: the tests
 * that mention a viewport go through src/domain/geometry both ways, so a zoom
 * or pan that breaks a gesture breaks these tests, not the demonstration.
 */

import { describe, expect, test } from 'vitest';
import type { Equipment, Viewport } from '../../contracts/model';
import { modelToScreen, screenToModel } from '../../domain/geometry';
import {
  MIN_SIZE_M,
  RESIZE_HANDLES,
  ROTATION_SNAP_DEG,
  grabOffset,
  handlePoint,
  resizeFromPointer,
  rotationFromPointer,
  rotationHandlePoint,
  snapPosition,
  type ResizeHandle,
} from './transform';

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
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...overrides,
  };
}

function handle(id: ResizeHandle['id']): ResizeHandle {
  const found = RESIZE_HANDLES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`нет ручки ${id}`);
  return found;
}

function expectPoint(actual: readonly number[], expected: readonly number[]): void {
  expect(actual[0]).toBeCloseTo(expected[0]!, 6);
  expect(actual[1]).toBeCloseTo(expected[1]!, 6);
}

describe('поворот за ручку', () => {
  test('угол считается от направления «вперёд» (+Y) по часовой стрелке — D-010', () => {
    const centre: [number, number] = [5, 5];
    expect(rotationFromPointer(centre, [5, 9], false, 0)).toBe(0);
    expect(rotationFromPointer(centre, [9, 5], false, 0)).toBe(90);
    expect(rotationFromPointer(centre, [5, 1], false, 0)).toBe(180);
    expect(rotationFromPointer(centre, [1, 5], false, 0)).toBe(270);
  });

  test('свободный поворот попадает в модель с точностью 0,1° и лежит в [0, 360)', () => {
    const angle = (37 * Math.PI) / 180;
    const pointer: [number, number] = [5 + 3 * Math.sin(angle), 5 + 3 * Math.cos(angle)];
    expect(rotationFromPointer([5, 5], pointer, false, 0)).toBe(37);

    // Чуть левее «вперёд»: не -3, а 357.
    const left = (-3 * Math.PI) / 180;
    const behind: [number, number] = [5 + 3 * Math.sin(left), 5 + 3 * Math.cos(left)];
    expect(rotationFromPointer([5, 5], behind, false, 0)).toBe(357);
  });

  test('с Shift угол прилипает к шагу 15° и не выходит за 360', () => {
    expect(ROTATION_SNAP_DEG).toBe(15);
    const at = (deg: number): [number, number] => [
      5 + 3 * Math.sin((deg * Math.PI) / 180),
      5 + 3 * Math.cos((deg * Math.PI) / 180),
    ];
    expect(rotationFromPointer([5, 5], at(37), true, 0)).toBe(30);
    expect(rotationFromPointer([5, 5], at(38), true, 0)).toBe(45);
    expect(rotationFromPointer([5, 5], at(-3), true, 0)).toBe(0);
    expect(rotationFromPointer([5, 5], at(91), true, 0)).toBe(90);
  });

  test('указатель в центре не меняет угол', () => {
    expect(rotationFromPointer([5, 5], [5, 5], false, 123)).toBe(123);
    expect(rotationFromPointer([5, 5], [5, 5], true, 123)).toBe(123);
    expect(rotationFromPointer([5, 5], [5, 5], false, -90)).toBe(270);
  });

  test('после zoom тот же экранный жест даёт тот же угол: считаем в мире, не в пикселях', () => {
    const near: Viewport = { origin: [100, 700], scale: 48 };
    const far: Viewport = { origin: [30, 900], scale: 133 };
    const item = object();
    for (const viewport of [near, far]) {
      const [cx, cy] = modelToScreen(item.position, viewport);
      // На экране Y вниз: вправо-вверх — это 45° по часовой от «вперёд».
      const pointer = screenToModel([cx + 120, cy - 120], viewport);
      expect(rotationFromPointer(item.position, pointer, false, 0)).toBe(45);
    }
  });
});

describe('ручки', () => {
  test('ручки размера стоят на углах и серединах сторон повёрнутого объекта', () => {
    const item = object();
    expectPoint(handlePoint(item, handle('ne')), [6, 5.5]);
    expectPoint(handlePoint(item, handle('sw')), [4, 4.5]);
    expectPoint(handlePoint(item, handle('n')), [5, 5.5]);
    expectPoint(handlePoint(item, handle('e')), [6, 5]);

    // 90° по часовой: локальный +X смотрит в мировой -Y.
    const turned = object({ rotation_deg: 90 });
    expectPoint(handlePoint(turned, handle('e')), [5, 4]);
    expectPoint(handlePoint(turned, handle('n')), [5.5, 5]);
  });

  test('ручка поворота вынесена вперёд объекта на заданный зазор', () => {
    expectPoint(rotationHandlePoint(object(), 0.5), [5, 6]);
    expectPoint(rotationHandlePoint(object({ rotation_deg: 90 }), 0.5), [6, 5]);
    expectPoint(rotationHandlePoint(object({ rotation_deg: 180 }), 0.5), [5, 4]);
  });

  test('восемь ручек с уникальными именами', () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    expect(new Set(RESIZE_HANDLES.map((entry) => entry.id)).size).toBe(8);
  });
});

describe('размер за ручку', () => {
  test('сторона тянется, противоположная стоит на месте', () => {
    const item = object();
    const result = resizeFromPointer(item, handle('e'), [7, 5.3]);
    expectPoint(result.size_m, [3, 1]);
    expectPoint(result.position, [5.5, 5]);
    // Западная кромка не сдвинулась.
    expectPoint(handlePoint({ ...item, ...result }, handle('w')), [4, 5]);
  });

  test('угол тянет обе стороны, противоположный угол стоит на месте', () => {
    const item = object();
    const result = resizeFromPointer(item, handle('ne'), [7, 7]);
    expectPoint(result.size_m, [3, 2.5]);
    expectPoint(result.position, [5.5, 5.75]);
    expectPoint(handlePoint({ ...item, ...result }, handle('sw')), [4, 4.5]);

    const shrink = resizeFromPointer(item, handle('sw'), [4.5, 4.8]);
    expectPoint(shrink.size_m, [1.5, 0.7]);
    expectPoint(handlePoint({ ...item, ...shrink }, handle('ne')), [6, 5.5]);
  });

  test('меньше минимума не бывает: 0,1 м, и объект не выворачивается', () => {
    expect(MIN_SIZE_M).toBe(0.1);
    const item = object();
    // Указатель ушёл за противоположную кромку.
    const result = resizeFromPointer(item, handle('e'), [3, 5]);
    expectPoint(result.size_m, [MIN_SIZE_M, 1]);
    expectPoint(result.position, [4 + MIN_SIZE_M / 2, 5]);
    expectPoint(handlePoint({ ...item, ...result }, handle('w')), [4, 5]);
  });

  test('повёрнутый объект тянется вдоль своих осей, а не мировых', () => {
    const item = object({ rotation_deg: 90 });
    // Восточная ручка лежит в (5, 4); тянем её дальше вниз по миру.
    const result = resizeFromPointer(item, handle('e'), [5.2, 3]);
    expectPoint(result.size_m, [3, 1]);
    expectPoint(result.position, [5, 4.5]);
    expectPoint(handlePoint({ ...item, ...result }, handle('w')), [5, 6]);
  });

  test('результат округлён до сантиметра', () => {
    const result = resizeFromPointer(object(), handle('e'), [7.123456, 5]);
    expect(result.size_m[0]).toBe(3.12);
    expect(result.position[0]).toBe(5.56);
  });

  test('ручка тянется от точки захвата: промах по ручке не прибавляется к размеру', () => {
    const item = object();
    // Ручка «e» стоит в (6, 5); пользователь нажал на 0,3 м правее и на
    // 0,1 м выше её центра — но всё ещё внутри ручки.
    const press: [number, number] = [6.3, 5.1];
    const grab = grabOffset(item, handle('e'), press);
    expectPoint(grab, [-0.3, -0.1]);

    // Нажатие без движения ничего не меняет: размер прежний.
    const held = resizeFromPointer(item, handle('e'), press, grab);
    expectPoint(held.size_m, [2, 1]);
    expectPoint(held.position, [5, 5]);

    // Провели на метр вправо — сторона выросла ровно на метр, а не на 1,3 м.
    const dragged = resizeFromPointer(item, handle('e'), [7.3, 5.1], grab);
    expectPoint(dragged.size_m, [3, 1]);
    expectPoint(dragged.position, [5.5, 5]);
  });

  test('захват повёрнутой ручки считается в мире, а не в осях объекта', () => {
    const item = object({ rotation_deg: 90 });
    // При 90° ручка «e» лежит в (5, 4).
    const grab = grabOffset(item, handle('e'), [5.25, 3.9]);
    expectPoint(grab, [-0.25, 0.1]);
    const result = resizeFromPointer(item, handle('e'), [5.25, 2.9], grab);
    expectPoint(result.size_m, [3, 1]);
    expectPoint(result.position, [5, 4.5]);
  });

  test('без захвата поведение прежнее: указатель и есть ручка', () => {
    const item = object();
    const withoutGrab = resizeFromPointer(item, handle('e'), [7, 5]);
    const withZeroGrab = resizeFromPointer(item, handle('e'), [7, 5], [0, 0]);
    expect(withZeroGrab).toEqual(withoutGrab);
  });

  test('после zoom тот же экранный жест даёт тот же размер', () => {
    const item = object();
    for (const scale of [20, 48, 133]) {
      const viewport: Viewport = { origin: [80, 600], scale };
      const [hx, hy] = modelToScreen(handlePoint(item, handle('n')), viewport);
      // Вверх по экрану на один метр в текущем масштабе.
      const pointer = screenToModel([hx, hy - scale], viewport);
      const result = resizeFromPointer(item, handle('n'), pointer);
      expectPoint(result.size_m, [2, 2]);
      expectPoint(result.position, [5, 5.5]);
    }
  });
});

describe('перенос', () => {
  test('позиция округляется до сантиметра', () => {
    expect(snapPosition([1.234567, 2.345678])).toEqual([1.23, 2.35]);
    expect(snapPosition([-0.004, 0.005])).toEqual([0, 0.01]);
  });
});
