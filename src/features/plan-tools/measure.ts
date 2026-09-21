/**
 * Инструмент «Линейка»: расстояние между двумя точками плана.
 *
 * Измерение — не часть плана. Оно не попадает ни в документ, ни в историю, ни
 * в сохранённый файл: это вопрос «сколько тут метров», заданный глазами, и
 * живёт он ровно до следующего вопроса, смены инструмента или `Escape`.
 * Поэтому канал тот же, что у `snap-marker.ts` и `notice.ts` рядом, — модульное
 * хранилище, которое читают и контроллер жеста, и слой Konva: между ними в
 * композиции нет ничего, кроме `src/app`, а кадру жеста там не место.
 *
 * Точки приходят уже привязанными — теми же правилами, что и рисование
 * (D-208/D-209): линейка, которая мажет мимо угла, меряет не то, что видит
 * пользователь.
 */

import { useSyncExternalStore } from 'react';
import type { Point } from '../../contracts/model';
import { segmentLength } from '../../domain/geometry';
import { formatLength } from '../../domain/number-format';

export type Measurement = {
  from: Point;
  to: Point;
  /**
   * `false` — второй конец ещё идёт за курсором, `true` — измерение закончено
   * вторым кликом и стоит на месте, пока его не сбросят.
   */
  fixed: boolean;
};

let current: Measurement | null = null;
const listeners = new Set<() => void>();

/** Два кадра одного жеста, которые нарисовали бы одно и то же. */
export function sameMeasurement(left: Measurement | null, right: Measurement | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.from[0] === right.from[0] &&
    left.from[1] === right.from[1] &&
    left.to[0] === right.to[0] &&
    left.to[1] === right.to[1] &&
    left.fixed === right.fixed
  );
}

/** Опубликовать измерение или `null`, чтобы убрать его с холста. */
export function setMeasurement(next: Measurement | null): void {
  if (sameMeasurement(current, next)) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeToMeasurement(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Текущее измерение вне React: его читают контроллер жеста и тест. */
export function getMeasurement(): Measurement | null {
  return current;
}

export function useMeasurement(): Measurement | null {
  return useSyncExternalStore(subscribeToMeasurement, getMeasurement, getMeasurement);
}

export function measurementLength(measurement: Measurement): number {
  return segmentLength(measurement.from, measurement.to);
}

/** «4,20 м» — тем же форматом, что и все длины в интерфейсе. */
export function measurementCaption(measurement: Measurement): string {
  return formatLength(measurementLength(measurement));
}
