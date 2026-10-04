import { useSyncExternalStore } from 'react';
import type { PlanDocument, Point } from '../../contracts/model';
import type { EditorSession } from '../../contracts/ui';
import { formatArea, formatLength, formatNumber } from '../../domain/number-format';
import { segmentReadout, selectionReadout } from './canvas-status';

/**
 * The pointer's place in model metres. It moves at pointer rate, so it is a
 * store of its own: only the readout re-renders, not the app around it.
 */
let cursor: Point | null = null;
const listeners = new Set<() => void>();

export function publishCanvasCursor(point: Point | null): void {
  if (cursor?.[0] === point?.[0] && cursor?.[1] === point?.[1]) return;
  cursor = point;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function CursorReadout(): React.JSX.Element {
  const point = useSyncExternalStore(subscribe, () => cursor);
  return (
    <span data-testid="status-cursor">
      {point === null ? 'X —  Y —' : `X ${formatNumber(point[0])}  Y ${formatNumber(point[1])} м`}
    </span>
  );
}

/**
 * Status line over the bottom-left corner of the canvas: cursor in model
 * metres (the same numbers as the properties card), the selection with its
 * floor area and, while drawing, the segment being drawn. Not interactive.
 */
export function CanvasStatus({
  document: plan,
  session,
  segment,
}: {
  document: PlanDocument;
  session: EditorSession;
  /** The drawn segment: the last placed vertex and the point under the pointer. */
  segment: readonly [Point, Point] | null;
}): React.JSX.Element {
  const selected = selectionReadout(plan, session);
  const drawn = segment === null ? null : segmentReadout(segment[0], segment[1]);
  return (
    <div className="canvas-status" data-testid="canvas-status">
      <CursorReadout />
      {selected === null ? null : (
        <span data-testid="status-selection">
          {selected.kind === 'zone' ? 'Зона' : `Выбрано: ${selected.count}`} · {formatArea(selected.area_m2)}
        </span>
      )}
      {drawn === null ? null : (
        <span data-testid="status-segment">
          Отрезок {formatLength(drawn.length_m)} · {formatNumber(drawn.angle_deg, 1)}°
        </span>
      )}
    </div>
  );
}
