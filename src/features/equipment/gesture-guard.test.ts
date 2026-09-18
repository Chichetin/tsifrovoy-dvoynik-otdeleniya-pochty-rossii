/**
 * U04: отмена жеста не зависит от того, когда придёт `dragend`.
 *
 * Konva может позвать `dragend` сразу из `stopDrag()`, позже или не позвать
 * вовсе — сторож хранит решение до конца жеста, а очищает его только начало
 * следующего.
 */

import { describe, expect, it } from 'vitest';
import type { Point } from '../../contracts/model';
import { createGestureGuard, type GestureNode, type GestureStart } from './gesture-guard';

function node(): GestureNode & { put: { x: number; y: number }[]; stopped: number } {
  return {
    put: [],
    stopped: 0,
    position(point: { x: number; y: number }) {
      this.put.push(point);
      return this;
    },
    stopDrag() {
      this.stopped += 1;
    },
  };
}

function start(overrides: Partial<GestureStart> = {}): GestureStart {
  return { node: node(), origin: { x: 10, y: 20 }, grab: [0, 0] as Point, ...overrides };
}

describe('сторож жеста', () => {
  it('законченный жест коммитится', () => {
    const guard = createGestureGuard();
    guard.begin(start());
    expect(guard.finish()).toBe(true);
  });

  it('отменённый жест не коммитится, когда бы ни пришёл dragend', () => {
    const guard = createGestureGuard();
    const gesture = start();
    guard.begin(gesture);
    expect(guard.cancel()).toBe(gesture);
    expect(guard.finish()).toBe(false);
  });

  it('отмена без жеста ничего не отменяет: Escape тогда принадлежит холсту', () => {
    const guard = createGestureGuard();
    expect(guard.cancel()).toBeNull();
    guard.begin(start());
    guard.finish();
    expect(guard.cancel()).toBeNull();
  });

  it('повторный Escape в одном жесте отменяет один раз', () => {
    const guard = createGestureGuard();
    guard.begin(start());
    expect(guard.cancel()).not.toBeNull();
    expect(guard.cancel()).toBeNull();
    expect(guard.finish()).toBe(false);
  });

  it('отмена не переносится на следующий жест, даже если dragend не пришёл', () => {
    const guard = createGestureGuard();
    guard.begin(start());
    guard.cancel();
    // dragend потерялся — следующий жест всё равно начинается чистым.
    guard.begin(start());
    expect(guard.finish()).toBe(true);
  });

  it('после отмены и dragend следующий жест снова коммитится', () => {
    const guard = createGestureGuard();
    guard.begin(start());
    guard.cancel();
    guard.finish();
    guard.begin(start());
    expect(guard.finish()).toBe(true);
  });

  it('жест помнит свой узел, точку старта и захват ручки', () => {
    const guard = createGestureGuard();
    expect(guard.started).toBeNull();
    const gesture = start({ origin: { x: 44, y: 77 }, grab: [-0.3, 0.1] });
    guard.begin(gesture);
    expect(guard.started?.origin).toEqual({ x: 44, y: 77 });
    expect(guard.started?.grab).toEqual([-0.3, 0.1]);
    guard.finish();
    expect(guard.started).toBeNull();
  });

  it('Escape вне своего жеста ничего не отменяет и следующий жест доходит', () => {
    const guard = createGestureGuard();

    // Escape по пустому холсту: отменять нечего.
    expect(guard.cancel()).toBeNull();

    // И он не должен «зарядить» отмену на жест, которого ещё не было:
    // dragend без dragstart прилетает от Konva, и команда обязана дойти.
    expect(guard.finish()).toBe(true);
  });

  it('отменённый жест возвращает узел туда, откуда начался', () => {
    const guard = createGestureGuard();
    const dragged = node();
    guard.begin({ node: dragged, origin: { x: 5, y: 6 }, grab: [0, 0] });
    const cancelled = guard.cancel();
    expect(cancelled).not.toBeNull();
    cancelled?.node.position(cancelled.origin);
    cancelled?.node.stopDrag();
    expect(dragged.put).toEqual([{ x: 5, y: 6 }]);
    expect(dragged.stopped).toBe(1);
  });
});
