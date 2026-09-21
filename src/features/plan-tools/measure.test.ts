/**
 * D-256: канал линейки. Измерение доходит до слоя, кадр, не меняющий картинку,
 * перерисовки не вызывает, а длина считается по точкам, а не приходит извне.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NBSP } from '../../domain/number-format';
import type { Measurement } from './measure';
import {
  getMeasurement,
  measurementCaption,
  measurementLength,
  sameMeasurement,
  setMeasurement,
  subscribeToMeasurement,
} from './measure';

afterEach(() => setMeasurement(null));

describe('канал измерения', () => {
  it('опубликованное измерение читается и снимается', () => {
    setMeasurement({ from: [0, 0], to: [3, 4], fixed: true });
    expect(getMeasurement()).toEqual({ from: [0, 0], to: [3, 4], fixed: true });
    setMeasurement(null);
    expect(getMeasurement()).toBeNull();
  });

  it('подписчика зовут на изменение и не зовут на тот же кадр', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToMeasurement(listener);

    setMeasurement({ from: [0, 0], to: [1, 0], fixed: false });
    expect(listener).toHaveBeenCalledTimes(1);

    setMeasurement({ from: [0, 0], to: [1, 0], fixed: false });
    expect(listener).toHaveBeenCalledTimes(1);

    // Тот же отрезок, но законченный, — это другая картинка.
    setMeasurement({ from: [0, 0], to: [1, 0], fixed: true });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setMeasurement(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('sameMeasurement различает конец отрезка и его состояние', () => {
    const base: Measurement = { from: [0, 0], to: [1, 1], fixed: false };
    expect(sameMeasurement(base, { ...base })).toBe(true);
    expect(sameMeasurement(base, { ...base, to: [1, 1.01] })).toBe(false);
    expect(sameMeasurement(base, null)).toBe(false);
    expect(sameMeasurement(null, null)).toBe(true);
  });
});

describe('длина измерения', () => {
  it('считается по точкам, а не по осям', () => {
    expect(measurementLength({ from: [0, 0], to: [3, 4], fixed: true })).toBe(5);
  });

  it('подписывается тем же форматом, что и все длины интерфейса', () => {
    expect(measurementCaption({ from: [1, 1], to: [1, 5.5], fixed: true })).toBe(`4,50${NBSP}м`);
  });
});
