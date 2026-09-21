/**
 * U-snap-target (D-224): what the next drawn point would catch, from the tool
 * controller that computes it to the layer that draws it.
 *
 * The same wire as `notice.ts` next door — a module-level external store both
 * sides of the package share — and for the same reason: the controller and the
 * Konva layer are two leaves of the composition with nothing between them but
 * `src/app`, and a frame of a gesture has no business in the document.
 *
 * A marker is a hint, not a fact of the plan: nothing published here reaches
 * the store, the history or the saved file. It lives for as long as the pointer
 * is over the canvas with a drawing tool in hand.
 */

import { useSyncExternalStore } from 'react';
import type { SnapHint, SnapTarget } from '../../domain/geometry';

let current: SnapHint | null = null;
const listeners = new Set<() => void>();

/**
 * Two frames of the same gesture that would draw the same marker. The pointer
 * moves by a pixel many times inside one grid cell, and the snapped point only
 * changes when it catches something else: comparing here keeps the canvas from
 * repainting on a move that changes nothing.
 */
export function sameHint(left: SnapHint | null, right: SnapHint | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.point[0] === right.point[0] &&
    left.point[1] === right.point[1] &&
    left.x?.target === right.x?.target &&
    left.y?.target === right.y?.target
  );
}

/**
 * Publish the marker, or `null` to take it off: the tool has changed, the
 * gesture is over, `Alt` is held, or the pointer is nowhere near a target.
 * A hint that caught nothing on either axis has nothing to show, so it is the
 * same as no hint — the canvas stays clean while the pointer crosses the middle
 * of a room.
 */
export function setSnapHint(hint: SnapHint | null): void {
  const next = hint === null || (hint.x === null && hint.y === null) ? null : hint;
  if (sameHint(current, next)) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Подписка на маркер: ею пользуется и хук ниже, и тест без React. */
export function subscribeToSnapHint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current marker outside React: what a test and a non-component caller read. */
export function getSnapHint(): SnapHint | null {
  return current;
}

export function useSnapHint(): SnapHint | null {
  return useSyncExternalStore(subscribeToSnapHint, getSnapHint, getSnapHint);
}

/**
 * Как цель называется на экране. Цвет отличает направляющую от сетки (D-215),
 * но не зону от стены — а это ровно то, что сотрудник, обводящий комнату,
 * должен увидеть до клика (находка operator 20.09 №5).
 */
export const TARGET_LABEL: Record<SnapTarget, string> = {
  wall: 'стена',
  room: 'контур помещения',
  zone: 'зона',
  grid: 'сетка 0,5 м',
};

/**
 * Подпись маркера: оси названы порознь, потому что тянутся порознь (D-209) —
 * «X: стена · Y: зона» и есть честный ответ, из-за которого обведённая комната
 * получалась не прямоугольником.
 */
export function hintCaption(hint: SnapHint): string | null {
  const parts: string[] = [];
  if (hint.x !== null) parts.push(`X: ${TARGET_LABEL[hint.x.target]}`);
  if (hint.y !== null) parts.push(`Y: ${TARGET_LABEL[hint.y.target]}`);
  return parts.length === 0 ? null : parts.join(' · ');
}
