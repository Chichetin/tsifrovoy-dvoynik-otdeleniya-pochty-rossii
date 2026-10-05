/**
 * U05-ux: подписи информационных слоёв не накладываются друг на друга и на
 * занятые места (имя зоны, легенда).
 */

import { describe, expect, test } from 'vitest';
import { boxesOverlap, labelWidth, placeLabels, type Box } from './label-layout';

const box = (x: number, y: number, width = 40, height = 16): Box => ({ x, y, width, height });

describe('boxesOverlap', () => {
  test('касание краем — не наложение', () => {
    expect(boxesOverlap(box(0, 0), box(40, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(0, 16))).toBe(false);
    // Порядок аргументов не важен: касание с другой стороны — тоже не наложение.
    expect(boxesOverlap(box(40, 0), box(0, 0))).toBe(false);
    expect(boxesOverlap(box(0, 16), box(0, 0))).toBe(false);
  });

  test('пересечение по обеим осям — наложение', () => {
    expect(boxesOverlap(box(0, 0), box(39, 15))).toBe(true);
  });

  test('пересечение только по одной оси — не наложение', () => {
    expect(boxesOverlap(box(0, 0), box(10, 30))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(50, 5))).toBe(false);
  });
});

describe('placeLabels', () => {
  test('свободная подпись остаётся на месте', () => {
    expect(placeLabels([], [box(10, 10)])).toEqual([box(10, 10)]);
  });

  test('две подписи в одной точке встают столбиком без зазора наложения', () => {
    const placed = placeLabels([], [box(10, 10), box(10, 10)]);
    expect(placed[0]).toEqual(box(10, 10));
    expect(placed[1]?.x).toBe(10);
    expect(placed[1]?.y).toBeGreaterThanOrEqual(26);
    expect(boxesOverlap(placed[0] as Box, placed[1] as Box)).toBe(false);
  });

  test('подпись обходит препятствие', () => {
    const placed = placeLabels([box(0, 0, 100, 20)], [box(10, 5)]);
    expect(boxesOverlap(placed[0] as Box, box(0, 0, 100, 20))).toBe(false);
  });

  test('никакие две подписи не пересекаются в плотной куче', () => {
    const requests = Array.from({ length: 12 }, (_, index) => box(10 + (index % 3) * 7, 10));
    const placed = placeLabels([box(0, 30, 200, 10)], requests);
    for (let i = 0; i < placed.length; i += 1) {
      expect(boxesOverlap(placed[i] as Box, box(0, 30, 200, 10))).toBe(false);
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(boxesOverlap(placed[i] as Box, placed[j] as Box)).toBe(false);
      }
    }
  });

  test('зазор: соседние подписи разнесены не меньше чем на gap', () => {
    const placed = placeLabels([], [box(10, 10), box(10, 10)], 3);
    expect(placed[1]?.y).toBe(29);
    const touching = placeLabels([box(0, 0, 100, 10)], [box(0, 11)], 3);
    expect(touching[0]?.y).toBe(13);
  });

  test('ширина подписи растёт с длиной текста и размером шрифта', () => {
    expect(labelWidth('80 %', 11)).toBeGreaterThan(labelWidth('8', 11));
    expect(labelWidth('80 %', 13)).toBeGreaterThan(labelWidth('80 %', 11));
  });
});
