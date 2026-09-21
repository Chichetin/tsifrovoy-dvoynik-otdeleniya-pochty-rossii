/**
 * Same behaviour as `zone-label.test.ts` (`plan-tools`, D-216): this file
 * covers the duplicated rule (D-241) on its own, so a mutation in the copy
 * is caught here without relying on the cross-module equivalence check in
 * `tests/e2e/layers.spec.ts`.
 */
import { describe, expect, test } from 'vitest';
import type { Polygon } from '../../contracts/model';
import { type BoundingBox, boxesOverlap } from '../../domain/geometry';
import { zoneNameAnchor } from './zone-name-anchor';

const square: Polygon = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
];

/** The same reserved footprint `zoneNameAnchor` itself checks against. */
function reservedAround([x, y]: [number, number]): BoundingBox {
  return { minX: x - 1.5, maxX: x + 1.5, minY: y - 0.25, maxY: y + 0.25 };
}

describe('якорь имени зоны для InformationLayer (D-241, копия D-216)', () => {
  test('ничего не мешает — подпись в центре', () => {
    expect(zoneNameAnchor(square, [])).toEqual([3, 3]);
  });

  test('объект в стороне от центра — подпись остаётся в центре', () => {
    const farAway: BoundingBox = { minX: 5.5, maxX: 5.9, minY: 5.5, maxY: 5.9 };
    expect(zoneNameAnchor(square, [farAway])).toEqual([3, 3]);
  });

  test('объект вне X-полосы подписи не мешает, даже если по Y совпадает с центром', () => {
    const besideRow: BoundingBox = { minX: 0, maxX: 1, minY: 2.9, maxY: 3.1 };
    expect(zoneNameAnchor(square, [besideRow])).toEqual([3, 3]);
  });

  test('объект перекрывает центр — подпись уходит по Y, X не трогает', () => {
    const atCentre: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 4 };
    const [x, y] = zoneNameAnchor(square, [atCentre]);
    expect(x).toBe(3);
    expect(y).not.toBe(3);
  });

  test('после сдвига подпись больше не перекрывает объект, который её сдвинул', () => {
    const atCentre: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 4 };
    const anchor = zoneNameAnchor(square, [atCentre]);
    expect(boxesOverlap(reservedAround(anchor), atCentre)).toBe(false);
  });

  test('два объекта рядом — сдвиг очищает обоих, а не только ближайшего', () => {
    const rackOne: BoundingBox = { minX: 2, maxX: 4, minY: 2.6, maxY: 3.1 };
    const rackTwo: BoundingBox = { minX: 2, maxX: 4, minY: 3.15, maxY: 3.6 };
    const anchor = zoneNameAnchor(square, [rackOne, rackTwo]);
    expect(boxesOverlap(reservedAround(anchor), rackOne)).toBe(false);
    expect(boxesOverlap(reservedAround(anchor), rackTwo)).toBe(false);
  });

  test('выбирает более короткий сдвиг, когда возможны оба направления', () => {
    const blocker: BoundingBox = { minX: 2, maxX: 4, minY: 2.9, maxY: 3.6 };
    const [, y] = zoneNameAnchor(square, [blocker]);
    expect(y).toBeLessThan(3);
  });

  test('объект прижат к нижней границе зоны — вверх уйти можно, вниз некуда', () => {
    const fromBottom: BoundingBox = { minX: 2, maxX: 4, minY: 0, maxY: 3.2 };
    const anchor = zoneNameAnchor(square, [fromBottom]);
    expect(anchor[1]).toBeCloseTo(3.57, 5);
    expect(boxesOverlap(reservedAround(anchor), fromBottom)).toBe(false);
  });

  test('объект прижат к верхней границе зоны — вниз уйти можно, вверх некуда', () => {
    const fromTop: BoundingBox = { minX: 2, maxX: 4, minY: 2.8, maxY: 6 };
    const anchor = zoneNameAnchor(square, [fromTop]);
    expect(anchor[1]).toBeCloseTo(2.43, 5);
    expect(boxesOverlap(reservedAround(anchor), fromTop)).toBe(false);
  });

  test('объект попал в полосу подписи, но не на её центральную ось — всё равно мешает', () => {
    const besideAxis: BoundingBox = { minX: 3.2, maxX: 4.2, minY: 2.4, maxY: 3.5 };
    const anchor = zoneNameAnchor(square, [besideAxis]);
    expect(anchor[1]).toBeCloseTo(3.87, 5);
    expect(boxesOverlap(reservedAround(anchor), besideAxis)).toBe(false);
  });

  test('между подписью и объектом остаётся зазор, а не касание', () => {
    const blocker: BoundingBox = { minX: 2, maxX: 4, minY: 2.4, maxY: 3.5 };
    const anchor = zoneNameAnchor(square, [blocker]);
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
    const [, y] = zoneNameAnchor(strip, [atCentre]);
    expect(y).toBeLessThanOrEqual(0.5);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  test('два объекта, чьи резервы касаются впритык (без зазора) — сливаются в один блок', () => {
    // Верх резерва первого объекта (maxY + GAP_M + HALF_HEIGHT_M) ровно
    // совпадает с низом резерва второго: `mergeIntervals` обязан считать их
    // одним блоком (`<=`), иначе якорь сядет в щель шириной 0 между ними.
    const rackOne: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 2.68 };
    const touchingBoundary = 2.68 + 0.12 + 0.25; // = rackTwo.minY - GAP_M - HALF_HEIGHT_M
    const rackTwo: BoundingBox = { minX: 2, maxX: 4, minY: touchingBoundary + 0.12 + 0.25, maxY: 4 };
    const anchor = zoneNameAnchor(square, [rackOne, rackTwo]);
    expect(boxesOverlap(reservedAround(anchor), rackOne)).toBe(false);
    expect(boxesOverlap(reservedAround(anchor), rackTwo)).toBe(false);
    // Не в щели между их резервами: та щель (если бы объекты не слились) была
    // бы уже, чем сама подпись, и якорь бы всё равно перекрыл один из них.
    expect(anchor[1]).not.toBeCloseTo(touchingBoundary, 1);
  });

  test('зона забита объектами настолько, что свободной строки нет — якорь остаётся внутри зоны и не садится на саму границу', () => {
    const blockers: BoundingBox[] = [
      { minX: 2, maxX: 4, minY: 0, maxY: 1.8 },
      { minX: 2, maxX: 4, minY: 2, maxY: 3.8 },
      { minX: 2, maxX: 4, minY: 4, maxY: 6 },
    ];
    const [x, y] = zoneNameAnchor(square, blockers);
    expect(x).toBe(3);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(6);
    expect(y).toBeCloseTo(5.55, 5);
  });
});
