/**
 * D-256: подпись длины стены говорит её настоящую длину и появляется только
 * тогда, когда помещается между концами стены.
 */

import { describe, expect, it } from 'vitest';
import type { Viewport, Wall } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { NBSP } from '../../domain/number-format';
import {
  WALL_LABEL_END_MARGIN_PX,
  wallLabelWidthPx,
  wallLengthLabel,
} from './wall-length-label';

const viewport: Viewport = { origin: [0, 0], scale: 50 };

function wall(from: Wall['from'], to: Wall['to'], thickness_m = 0.2): Wall {
  return { id: 'w_test', from, to, thickness_m, height_m: 3 };
}

describe('wallLengthLabel', () => {
  it('говорит длину стены по-русски: запятая и неразрывный пробел перед «м»', () => {
    const label = wallLengthLabel(wall([0, 0], [4.2, 0]), viewport);
    expect(label?.text).toBe(`4,20${NBSP}м`);
  });

  it('длина берётся из геометрии, а не из проекции на ось: косая стена', () => {
    // 3-4-5: длина ровно 5 м, хотя ни по X, ни по Y её не видно.
    const label = wallLengthLabel(wall([0, 0], [3, 4]), viewport);
    expect(label?.text).toBe(`5,00${NBSP}м`);
  });

  it('стена, на которой подпись не помещается, остаётся без подписи', () => {
    const text = `0,60${NBSP}м`;
    const needed = wallLabelWidthPx(text) + WALL_LABEL_END_MARGIN_PX * 2;
    // 0,60 м при масштабе 50 px/м — это 30 px на экране, подписи нужно больше.
    expect(needed).toBeGreaterThan(0.6 * viewport.scale);
    expect(wallLengthLabel(wall([0, 0], [0.6, 0]), viewport)).toBeNull();
  });

  it('та же стена на крупном масштабе подпись получает: порог — про экран, а не про метры', () => {
    const zoomed: Viewport = { origin: [0, 0], scale: 300 };
    expect(wallLengthLabel(wall([0, 0], [0.6, 0]), zoomed)?.text).toBe(`0,60${NBSP}м`);
  });

  it('стена нулевой длины подписи не получает', () => {
    expect(wallLengthLabel(wall([2, 2], [2, 2]), viewport)).toBeNull();
  });

  it('подпись стоит у середины стены и сдвинута с неё вбок', () => {
    const label = wallLengthLabel(wall([0, 0], [6, 0]), viewport);
    expect(label?.x).toBe(3 * viewport.scale);
    // Середина горизонтальной стены на экране — y = 0; подпись выше неё.
    expect(label?.y).toBeLessThan(0);
  });

  it('стена, идущая справа налево, читается не зеркально: поворот в пределах ±90°', () => {
    const forward = wallLengthLabel(wall([0, 0], [6, 0]), viewport);
    const backward = wallLengthLabel(wall([6, 0], [0, 0]), viewport);
    expect(forward?.rotation).toBe(0);
    expect(backward?.rotation).toBe(0);

    for (const to of [
      [4, 4],
      [-4, 4],
      [-4, -4],
      [4, -4],
    ] as const) {
      const label = wallLengthLabel(wall([0, 0], [to[0], to[1]]), viewport);
      expect(Math.abs(label?.rotation ?? 999)).toBeLessThanOrEqual(90);
    }
  });

  it('обе стороны одной стены подписаны с одной стороны: подписи не прыгают', () => {
    const forward = wallLengthLabel(wall([0, 0], [6, 0]), viewport);
    const backward = wallLengthLabel(wall([6, 0], [0, 0]), viewport);
    expect(forward?.y).toBe(backward?.y);
  });

  it('чем толще стена, тем дальше от неё подпись: текст не ложится на заливку', () => {
    const thin = wallLengthLabel(wall([0, 0], [6, 0], 0.1), viewport);
    const thick = wallLengthLabel(wall([0, 0], [6, 0], 0.5), viewport);
    expect(thick?.y).toBeLessThan(thin?.y ?? 0);
  });
});

describe('сторона подписи', () => {
  const south = wall([0, 0], [10, 0]);
  const north = wall([0, 8], [10, 8]);
  const centre: [number, number] = [5, 4];

  it('подпись уходит от заданной точки: у наружных стен — наружу помещения', () => {
    // Экранный Y растёт вниз: снаружи южной стены — ниже её, снаружи северной — выше.
    const middleOfSouth = modelToScreen([5, 0], viewport)[1];
    const middleOfNorth = modelToScreen([5, 8], viewport)[1];

    expect(wallLengthLabel(south, viewport, centre)?.y).toBeGreaterThan(middleOfSouth);
    expect(wallLengthLabel(north, viewport, centre)?.y).toBeLessThan(middleOfNorth);
  });

  it('без точки отсчёта сторона одна для всех: вверх экрана', () => {
    expect(wallLengthLabel(south, viewport)?.y).toBeLessThan(modelToScreen([5, 0], viewport)[1]);
    expect(wallLengthLabel(north, viewport)?.y).toBeLessThan(modelToScreen([5, 8], viewport)[1]);
  });

  it('стена через саму точку отсчёта откатывается на то же общее правило', () => {
    const through = wall([0, 4], [10, 4]);
    expect(wallLengthLabel(through, viewport, centre)?.y).toBe(
      wallLengthLabel(through, viewport)?.y,
    );
  });

  it('направление рисования стены сторону не меняет', () => {
    const back = wall([10, 0], [0, 0]);
    expect(wallLengthLabel(south, viewport, centre)?.y).toBe(
      wallLengthLabel(back, viewport, centre)?.y,
    );
  });
});
