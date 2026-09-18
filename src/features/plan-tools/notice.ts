/**
 * U03 (feedback): the one line the plan tools say about the last gesture.
 *
 * A refused gesture — a ring dragged into a self-intersection, a vertex that
 * cannot be removed — never reaches the store, so the app's command error bar
 * never learns about it. The Konva layer that refused it has no DOM to write
 * into either; the toolbar does. This module is the wire between them:
 * session-only, never persisted, nothing of the document lives here.
 */

import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

export function setNotice(text: string | null): void {
  if (current === text) return;
  current = text;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string | null {
  return current;
}

/** The current notice outside React: what a test and a non-component caller read. */
export function getNotice(): string | null {
  return current;
}

export function useNotice(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Texts of the refusals. They live next to the channel that carries them, so
 * the layer that refuses a gesture and the toolbar that shows it never drift
 * apart, and a test asserts the same constant the user reads.
 */
export const SELF_INTERSECTION_NOTICE =
  'Контур самопересекается — правка отклонена, план не изменён';
export const MIN_VERTICES_NOTICE = 'В контуре должно остаться не меньше трёх вершин';
export const DRAFT_SELF_INTERSECTION_NOTICE =
  'Контур самопересекается — добавьте точки или отмените рисование клавишей Esc';
export const HIDDEN_ZONE_NOTICE =
  'Зона лежит на скрытом слое — покажите слой, чтобы её удалить';
export const NO_WALL_UNDER_POINTER_NOTICE =
  'Здесь нет стены — проём ставится кликом по стене или перегородке';
export const WALL_TOO_SHORT_NOTICE =
  'Отрезок слишком короткий для перегородки — проведите линию длиннее';
export const OPENING_WIDER_THAN_WALL_NOTICE =
  'Стена короче проёма — выберите стену длиннее или другой вид проёма';

export const NEAR_VERTEX_NOTICE =
  'Клик пришёлся у вершины — вершина не добавлена; кликните ближе к середине ребра';
