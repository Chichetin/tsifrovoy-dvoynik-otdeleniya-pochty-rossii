/**
 * U02 unit checks: the arithmetic behind pan, zoom and fit.
 *
 * The behaviour the jury will feel — "I zoomed on the cashier window and it
 * stayed under my cursor", "the plan opened already fitted" — is decided here,
 * not in the canvas component, so it is pinned here too.
 */

import { describe, expect, test } from 'vitest';
import type { Point, Polygon, Viewport } from '../../contracts/model';
import { modelToScreen, screenToModel } from '../../domain/geometry';
import {
  OVERLAY_RESERVE_PX,
  OVERLAY_RIGHT_RESERVE_PX,
  SCALE_LIMITS,
  clampScale,
  fitToExtent,
  gridLines,
  gridStep,
  panBy,
  visibleExtent,
  wheelIntent,
  wheelPan,
  zoomAt,
  zoomByWheel,
} from './viewport';

const canvas = { width: 800, height: 600 };
const room: Polygon = [
  [0, 0],
  [10.4, 0],
  [10.4, 7.5],
  [0, 7.5],
];

function closeTo(actual: Point, expected: Point, precision = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
}

describe('масштаб держится в пределах', () => {
  test('за границами обрезается, мусор даёт минимум', () => {
    expect(clampScale(1)).toBe(SCALE_LIMITS.min);
    expect(clampScale(10_000)).toBe(SCALE_LIMITS.max);
    expect(clampScale(Number.NaN)).toBe(SCALE_LIMITS.min);
    expect(clampScale(50)).toBe(50);
  });

  test('на пределе zoom перестаёт двигать вид, а не дрожит', () => {
    const atMax: Viewport = { origin: [0, 0], scale: SCALE_LIMITS.max };
    expect(zoomAt(atMax, [400, 300], 2)).toBe(atMax);
  });
});

describe('zoom у курсора', () => {
  test('мировая точка под курсором остаётся под курсором', () => {
    const viewport: Viewport = { origin: [120, 500], scale: 40 };
    const cursor: Point = [530, 210];
    const worldBefore = screenToModel(cursor, viewport);

    for (const factor of [1.2, 0.8, 2, 0.5]) {
      const zoomed = zoomAt(viewport, cursor, factor);
      closeTo(modelToScreen(worldBefore, zoomed), cursor, 6);
    }
  });

  test('колесо вниз отдаляет, вверх приближает', () => {
    const viewport: Viewport = { origin: [100, 400], scale: 40 };
    expect(zoomByWheel(viewport, [400, 300], 100).scale).toBeLessThan(viewport.scale);
    expect(zoomByWheel(viewport, [400, 300], -100).scale).toBeGreaterThan(viewport.scale);
  });

  test('после pan и zoom центр объекта всё ещё переводится туда и обратно', () => {
    const start: Viewport = { origin: [80, 520], scale: 36 };
    const moved = panBy(start, [-140, 65]);
    const zoomed = zoomByWheel(moved, [610, 180], -240);

    const centre: Point = [6.5, 1.5];
    closeTo(screenToModel(modelToScreen(centre, zoomed), zoomed), centre);
  });
});

describe('жесты колеса', () => {
  test('плавные пиксельные дельты тачпада означают pan', () => {
    expect(wheelIntent({ deltaX: 18, deltaY: -12, deltaMode: 0, ctrlKey: false })).toBe('pan');
    expect(wheelIntent({ deltaX: 0, deltaY: 16, deltaMode: 0, ctrlKey: false })).toBe('pan');
  });

  test('дискретное вращение колеса означает zoom', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: -120, deltaMode: 0, ctrlKey: false })).toBe('zoom');
    expect(wheelIntent({ deltaX: 0, deltaY: -1, deltaMode: 1, ctrlKey: false })).toBe('zoom');
  });

  test('свайп листает план, как страницу: план едет против дельты колеса (D-272)', () => {
    const start: Viewport = { origin: [100, 400], scale: 40 };
    // Дельта вправо-вниз — план уходит влево-вверх на те же пиксели.
    expect(panBy(start, wheelPan([18, 16])).origin).toEqual([82, 384]);
    expect(panBy(start, wheelPan([-5, -30])).origin).toEqual([105, 430]);
    expect(panBy(start, wheelPan([0, 0])).origin).toEqual([100, 400]);
  });

  test('Ctrl принудительно оставляет zoom даже у плавной дельты', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: -12, deltaMode: 0, ctrlKey: true })).toBe('zoom');
  });
});

describe('вписывание плана', () => {
  test('помещение целиком попадает на холст с отступом', () => {
    const viewport = fitToExtent(room, canvas);
    const corners = room.map((point) => modelToScreen(point, viewport));

    for (const [x, y] of corners) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(canvas.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(canvas.height);
    }
  });

  test('план оказывается по центру холста над полосой масштаба и левее кнопок', () => {
    const viewport = fitToExtent(room, canvas);
    closeTo(
      modelToScreen([10.4 / 2, 7.5 / 2], viewport),
      [(canvas.width - OVERLAY_RIGHT_RESERVE_PX) / 2, (canvas.height - OVERLAY_RESERVE_PX) / 2],
      6,
    );
    closeTo(modelToScreen([10.4 / 2, 7.5 / 2], fitToExtent(room, canvas, 32, 0, 0)), [canvas.width / 2, canvas.height / 2], 6);
  });

  test('#236: вписанный план не заходит под кнопки в правом верхнем углу', () => {
    // The buttons: 12 px from the right edge, 34 px wide.
    for (const size of [canvas, { width: 664, height: 671 }, { width: 1200, height: 400 }, { width: 2000, height: 300 }]) {
      const viewport = fitToExtent(room, size);
      for (const point of room) {
        expect(modelToScreen(point, viewport)[0]).toBeLessThanOrEqual(size.width - Math.min(12 + 34 + 8, size.width / 3));
      }
    }
  });

  test('#233: вписанный план не заходит под панель масштаба и кнопку ассистента', () => {
    // The scale panel: its top 40 px above the bottom edge. The avatar: 58 px
    // from the right edge, 99 px up.
    for (const size of [canvas, { width: 664, height: 671 }, { width: 1200, height: 400 }]) {
      const viewport = fitToExtent(room, size);
      for (const point of room) {
        const [x, y] = modelToScreen(point, viewport);
        expect(y).toBeLessThanOrEqual(size.height - 40 - 8);
        expect(x).toBeLessThanOrEqual(size.width - 58 - 8);
      }
    }
  });

  test('узкий холст вписывает по стеснённой стороне', () => {
    const narrow = fitToExtent(room, { width: 300, height: 900 });
    const wide = fitToExtent(room, { width: 900, height: 300 });
    expect(narrow.scale).toBeLessThan(wide.scale * 4);
    expect(narrow.scale).toBeGreaterThan(SCALE_LIMITS.min);
  });

  test('пустой и вырожденный план не ломают вид', () => {
    expect(Number.isFinite(fitToExtent([], canvas).scale)).toBe(true);
    const degenerate = fitToExtent(
      [
        [2, 2],
        [2, 2],
        [2, 2],
      ],
      canvas,
    );
    expect(Number.isFinite(degenerate.scale)).toBe(true);
    expect(Number.isFinite(degenerate.origin[0])).toBe(true);
  });
});

describe('видимая область и сетка', () => {
  test('видимая область покрывает холст и не больше', () => {
    const viewport = fitToExtent(room, canvas);
    const extent = visibleExtent(viewport, canvas);

    closeTo(modelToScreen(extent[3] as Point, viewport), [0, 0], 6);
    closeTo(modelToScreen(extent[1] as Point, viewport), [canvas.width, canvas.height], 6);
  });

  test('шаг сетки держит линии в читаемом диапазоне на любом масштабе', () => {
    for (let scale = SCALE_LIMITS.min; scale <= SCALE_LIMITS.max; scale += 3) {
      const pixels = gridStep(scale) * scale;
      expect(pixels).toBeGreaterThanOrEqual(24);
      expect(pixels).toBeLessThanOrEqual(240);
    }
  });

  test('шаг — круглое число из ряда 1-2-5', () => {
    for (const scale of [5, 12, 40, 90, 200, 400]) {
      const step = gridStep(scale);
      const magnitude = 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Number((step / magnitude).toFixed(6)));
    }
  });

  test('линии сетки покрывают холст и совпадают с целыми метрами', () => {
    const viewport = fitToExtent(room, canvas);
    const { vertical, horizontal, step_m } = gridLines(viewport, canvas);

    expect(vertical.length).toBeGreaterThan(1);
    expect(horizontal.length).toBeGreaterThan(1);
    for (const x of vertical) {
      const world = screenToModel([x, 0], viewport)[0];
      expect(Math.abs(world / step_m - Math.round(world / step_m))).toBeLessThan(1e-6);
    }
  });
});
