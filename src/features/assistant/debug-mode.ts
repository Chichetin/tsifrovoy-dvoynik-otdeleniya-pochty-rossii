/**
 * #252: «Отладка» — the one switch that shows ids and service lines in the
 * assistant panel. Off by default. It lives in this browser's localStorage,
 * never in the plan file. The «Настройки» window writes it, the panel reads it.
 */

import { useSyncExternalStore } from 'react';

export const DEBUG_STORAGE_KEY = 'ops-twin.debug.v1';

const listeners = new Set<() => void>();
let debug: boolean | null = null;

function stored(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function readDebugMode(): boolean {
  debug ??= stored();
  return debug;
}

export function setDebugMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DEBUG_STORAGE_KEY, 'on');
    else window.localStorage.removeItem(DEBUG_STORAGE_KEY);
  } catch {
    // Storage is full or switched off: the choice holds until the page reloads.
  }
  debug = on;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDebugMode(): boolean {
  return useSyncExternalStore(subscribe, readDebugMode, () => false);
}

/** A focus button's `title`: the id is service information, shown only in «Отладка». */
export function focusTitle(id: string, debugOn: boolean): string {
  return debugOn ? `Показать на плане · id ${id}` : 'Показать на плане';
}
