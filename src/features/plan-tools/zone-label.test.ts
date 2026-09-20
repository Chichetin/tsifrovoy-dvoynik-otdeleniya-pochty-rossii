import { describe, expect, test } from 'vitest';
import type { Polygon } from '../../contracts/model';
import { type BoundingBox, boxesOverlap } from '../../domain/geometry';
import { zoneLabelAnchor } from './zone-label';

const square: Polygon = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
];

/** The same reserved footprint `zoneLabelAnchor` itself checks against. */
function reservedAround([x, y]: [number, number]): BoundingBox {
  return { minX: x - 1.5, maxX: x + 1.5, minY: y - 0.25, maxY: y + 0.25 };
}

describe('якорь подписи зоны (D-216)', () => {
  test('ничего не мешает — подпись в центре', () => {
    expect(zoneLabelAnchor(square, [])).toEqual([3, 3]);
  });

  test('объект в стороне от центра — подпись остаётся в центре', () => {
    const farAway: BoundingBox = { minX: 5.5, maxX: 5.9, minY: 5.5, maxY: 5.9 };
    expect(zoneLabelAnchor(square, [farAway])).toEqual([3, 3]);
  });

  test('объект вне X-полосы подписи не мешает, даже если по Y совпадает с центром', () => {
    // Ширина резерва подписи — 3 м вокруг центра (X от 1,5 до 4,5); объект
    // левее этой полосы, хотя по Y ровно на высоте центра.
    const besideRow: BoundingBox = { minX: 0, maxX: 1, minY: 2.9, maxY: 3.1 };
    expect(zoneLabelAnchor(square, [besideRow])).toEqual([3, 3]);
  });

  test('объект перекрывает центр — подпись уходит по Y, X не трогает', () => {
    const atCentre: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 4 };
    const [x, y] = zoneLabelAnchor(square, [atCentre]);
    expect(x).toBe(3);
    expect(y).not.toBe(3);
  });

  test('после сдвига подпись больше не перекрывает объект, который её сдвинул', () => {
    const atCentre: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 4 };
    const anchor = zoneLabelAnchor(square, [atCentre]);
    expect(boxesOverlap(reservedAround(anchor), atCentre)).toBe(false);
  });

  test('два объекта рядом — сдвиг очищает обоих, а не только ближайшего', () => {
    // Стеллаж и соседний с ним объект образуют один непрерывный блок по Y:
    // уйти нужно за пределы обоих, а не приземлиться между ними.
    const rackOne: BoundingBox = { minX: 2, maxX: 4, minY: 2.6, maxY: 3.1 };
    const rackTwo: BoundingBox = { minX: 2, maxX: 4, minY: 3.15, maxY: 3.6 };
    const anchor = zoneLabelAnchor(square, [rackOne, rackTwo]);
    expect(boxesOverlap(reservedAround(anchor), rackOne)).toBe(false);
    expect(boxesOverlap(reservedAround(anchor), rackTwo)).toBe(false);
  });

  test('выбирает более короткий сдвиг, когда возможны оба направления', () => {
    // Блокер выступает от центра (Y=3) больше вверх (до 3,6), чем вниз (до
    // 2,9) — путь вниз, под его нижний край, короче, чем путь над верхним.
    const blocker: BoundingBox = { minX: 2, maxX: 4, minY: 2.9, maxY: 3.6 };
    const [, y] = zoneLabelAnchor(square, [blocker]);
    expect(y).toBeLessThan(3);
  });

  test('объект прижат к нижней границе зоны — вверх уйти можно, вниз некуда', () => {
    // Свободна только одна сторона: под объектом остаётся 0 м, и разойтись
    // подпись может лишь над его верхним краем. Резерв подписи — 0,25 м от
    // её середины плюс зазор 0,12 м, отсюда 3,2 + 0,37.
    const fromBottom: BoundingBox = { minX: 2, maxX: 4, minY: 0, maxY: 3.2 };
    const anchor = zoneLabelAnchor(square, [fromBottom]);
    expect(anchor[1]).toBeCloseTo(3.57, 5);
    expect(boxesOverlap(reservedAround(anchor), fromBottom)).toBe(false);
  });

  test('объект прижат к верхней границе зоны — вниз уйти можно, вверх некуда', () => {
    // Зеркальный случай: над объектом свободного места нет, подпись обязана
    // уйти под его нижний край (2,8 − 0,37), а не за верхний.
    const fromTop: BoundingBox = { minX: 2, maxX: 4, minY: 2.8, maxY: 6 };
    const anchor = zoneLabelAnchor(square, [fromTop]);
    expect(anchor[1]).toBeCloseTo(2.43, 5);
    expect(boxesOverlap(reservedAround(anchor), fromTop)).toBe(false);
  });

  test('объект попал в полосу подписи, но не на её центральную ось — всё равно мешает', () => {
    // Подпись — это строка шириной 3 м вокруг центра (X от 1,5 до 4,5), а не
    // точка: объект правее оси X=3 её всё равно перекрывает.
    const besideAxis: BoundingBox = { minX: 3.2, maxX: 4.2, minY: 2.4, maxY: 3.5 };
    const anchor = zoneLabelAnchor(square, [besideAxis]);
    expect(anchor[1]).toBeCloseTo(3.87, 5);
    expect(boxesOverlap(reservedAround(anchor), besideAxis)).toBe(false);
  });

  test('между подписью и объектом остаётся зазор, а не касание', () => {
    const blocker: BoundingBox = { minX: 2, maxX: 4, minY: 2.4, maxY: 3.5 };
    const anchor = zoneLabelAnchor(square, [blocker]);
    // Нижний край резерва подписи выше верхнего края объекта ровно на GAP_M.
    expect(reservedAround(anchor).minY - blocker.maxY).toBeCloseTo(0.12, 5);
  });

  test('мелкая полоса вдоль стены — якорь не выходит за её пределы', () => {
    const strip: Polygon = [
      [0, 0],
      [4, 0],
      [4, 0.5],
      [0, 0.5],
    ];
    const atCentre: BoundingBox = { minX: 1, maxX: 3, minY: 0, maxY: 0.5 };
    const [, y] = zoneLabelAnchor(strip, [atCentre]);
    expect(y).toBeLessThanOrEqual(0.5);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  test('зона забита объектами настолько, что свободной строки нет — якорь остаётся внутри зоны и не садится на саму границу', () => {
    // По периметру зоны обычно идёт перегородка (`wallPolygon`), нарисованная
    // поверх подписей: якорь, прижатый вплотную к границе, был бы скрыт под
    // ней — хуже, чем близость к объекту, которую он и пытался обойти.
    const blockers: BoundingBox[] = [
      { minX: 2, maxX: 4, minY: 0, maxY: 1.8 },
      { minX: 2, maxX: 4, minY: 2, maxY: 3.8 },
      { minX: 2, maxX: 4, minY: 4, maxY: 6 },
    ];
    const [x, y] = zoneLabelAnchor(square, blockers);
    expect(x).toBe(3);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(6);
    // Не просто «внутри зоны» (эта зона высотой 6 м и без резерва по краю
    // держится внутри) — конкретно на 0,2 м дальше от границы, чем без него.
    expect(y).toBeCloseTo(5.55, 5);
  });
});
