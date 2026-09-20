/** Shared column resizing for the inventory and area tables (D-213). */

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const STORAGE_PREFIX = 'posttech:table-columns:';
const FALLBACK_TABLE_WIDTH_PX = 320;

export type ResizableColumns = {
  widths: number[];
  separator: (boundary: number, label: string) => React.JSX.Element;
};

/** Move one boundary while keeping the table at 100% and both neighbours usable. */
export function resizeColumns(
  widths: readonly number[],
  boundary: number,
  deltaPercent: number,
  minPercent: number,
): number[] {
  const left = widths[boundary];
  const right = widths[boundary + 1];
  if (left === undefined || right === undefined || !Number.isFinite(deltaPercent)) return [...widths];
  const delta = Math.max(minPercent - left, Math.min(right - minPercent, deltaPercent));
  return widths.map((width, index) => {
    if (index === boundary) return Math.round((width + delta) * 100) / 100;
    if (index === boundary + 1) return Math.round((width - delta) * 100) / 100;
    return width;
  });
}

/** Bad or obsolete browser data must never make a column disappear. */
export function loadColumnWidths(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
  defaults: readonly number[],
  minPercent: number,
): number[] {
  if (storage === undefined) return [...defaults];
  try {
    const value: unknown = JSON.parse(storage.getItem(`${STORAGE_PREFIX}${key}`) ?? 'null');
    if (
      !Array.isArray(value)
      || value.length !== defaults.length
      || value.some((width) => typeof width !== 'number' || !Number.isFinite(width) || width < minPercent)
      || Math.abs(value.reduce((sum, width) => sum + width, 0) - 100) > 0.1
    ) return [...defaults];
    return value;
  } catch {
    return [...defaults];
  }
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function saveColumnWidths(key: string, widths: readonly number[]): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(widths));
  } catch {
    // The table still resizes for this session when storage is unavailable.
  }
}

export function useResizableColumns(
  key: string,
  defaults: readonly number[],
  minPercent = 10,
): ResizableColumns {
  const [widths, setWidths] = useState(() =>
    loadColumnWidths(browserStorage(), key, defaults, minPercent),
  );
  const stopDrag = useRef<(() => void) | null>(null);

  useEffect(() => saveColumnWidths(key, widths), [key, widths]);
  useEffect(() => () => stopDrag.current?.(), []);

  const change = (boundary: number, deltaPercent: number): void => {
    setWidths((current) => resizeColumns(current, boundary, deltaPercent, minPercent));
  };

  const pointerDown = (event: ReactPointerEvent<HTMLSpanElement>, boundary: number): void => {
    event.preventDefault();
    event.stopPropagation();
    const table = event.currentTarget.closest('table');
    const measured = table?.getBoundingClientRect().width ?? 0;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const start = [...widths];
    const tableWidth = measured > 0 ? measured : FALLBACK_TABLE_WIDTH_PX;
    stopDrag.current?.();

    const move = (next: globalThis.PointerEvent): void => {
      if (next.pointerId !== pointerId) return;
      const delta = ((next.clientX - startX) / tableWidth) * 100;
      setWidths(resizeColumns(start, boundary, delta, minPercent));
    };
    const finish = (next?: globalThis.PointerEvent): void => {
      if (next !== undefined && next.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      stopDrag.current = null;
    };
    stopDrag.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const keyDown = (event: KeyboardEvent<HTMLSpanElement>, boundary: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    change(boundary, event.key === 'ArrowRight' ? 2 : -2);
  };

  const separator = (boundary: number, label: string): React.JSX.Element => (
    <span
      className="table__resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(widths[boundary] ?? 0)}
      tabIndex={0}
      data-testid="column-resize"
      data-boundary={boundary}
      title="Потяните для изменения ширины; двойной щелчок — сброс"
      onPointerDown={(event) => pointerDown(event, boundary)}
      onKeyDown={(event) => keyDown(event, boundary)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setWidths([...defaults]);
      }}
    />
  );

  return { widths, separator };
}
