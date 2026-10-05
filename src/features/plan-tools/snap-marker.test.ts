/**
 * U-snap-target (D-224): канал маркера цели и его подпись.
 *
 * Проверяется поведение, которое видит пользователь: подпись называет обе оси
 * порознь, маркер снимается, когда показывать нечего, и лишних перерисовок на
 * одинаковых кадрах жеста нет.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AxisHint, SnapHint } from '../../domain/geometry';
import { getSnapHint, hintCaption, sameHint, setSnapHint, subscribeToSnapHint } from './snap-marker';

function axis(target: AxisHint['target'], value = 7): AxisHint {
  return { value, delta: 0.05, kind: target === 'grid' ? 'grid' : 'guide', target };
}

function hint(x: AxisHint | null, y: AxisHint | null, point: [number, number] = [7, 7.9]): SnapHint {
  return { point, x, y };
}

beforeEach(() => setSnapHint(null));

describe('подпись маркера', () => {
  test('оси названы порознь: X может сесть на стену, Y на зону', () => {
    expect(hintCaption(hint(axis('wall'), axis('zone')))).toBe('X: стена · Y: зона');
    expect(hintCaption(hint(axis('room'), axis('grid')))).toBe('X: контур помещения · Y: сетка 0,5 м');
  });

  test('прилипла одна ось — в подписи одна ось', () => {
    expect(hintCaption(hint(axis('wall'), null))).toBe('X: стена');
    expect(hintCaption(hint(null, axis('grid')))).toBe('Y: сетка 0,5 м');
    expect(hintCaption(hint(null, null))).toBeNull();
  });
});

describe('канал маркера', () => {
  test('маркер публикуется и снимается', () => {
    const shown = hint(axis('wall'), null);
    setSnapHint(shown);
    expect(getSnapHint()).toBe(shown);
    setSnapHint(null);
    expect(getSnapHint()).toBeNull();
  });

  test('подсказка, не поймавшая ничего, — это отсутствие подсказки', () => {
    setSnapHint(hint(null, null));
    expect(getSnapHint()).toBeNull();
  });

  test('одинаковые кадры жеста холст не перерисовывают', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSnapHint(listener);
    setSnapHint(hint(axis('wall'), axis('grid')));
    expect(listener).toHaveBeenCalledTimes(1);
    // Мышь сдвинулась на пиксель внутри той же клетки: точка и цели те же.
    setSnapHint(hint(axis('wall'), axis('grid')));
    expect(listener).toHaveBeenCalledTimes(1);
    // Та же точка, но по Y теперь стена, а не сетка, — это уже другой ответ.
    setSnapHint(hint(axis('wall'), axis('wall')));
    expect(listener).toHaveBeenCalledTimes(2);
    // И точка та же, и цели те же, но по другой координате — маркер переезжает.
    setSnapHint(hint(axis('wall'), axis('wall'), [7, 8.1]));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  test('sameHint: пустой кадр равен только пустому', () => {
    expect(sameHint(null, null)).toBe(true);
    expect(sameHint(null, hint(axis('wall'), null))).toBe(false);
    expect(sameHint(hint(axis('wall'), null), null)).toBe(false);
    // Цель по оси Y появилась — кадр другой, даже если точка совпала.
    expect(sameHint(hint(axis('wall'), null), hint(axis('wall'), axis('grid')))).toBe(false);
  });
});
