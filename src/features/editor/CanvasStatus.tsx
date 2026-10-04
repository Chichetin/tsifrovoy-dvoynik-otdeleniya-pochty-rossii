import { useMemo, useSyncExternalStore } from 'react';
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

export function publishCanvasCursor(point: Point): void {
  if (cursor?.[0] === point[0] && cursor[1] === point[1]) return;
  cursor = point;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const position = (point: Point | null): string =>
  point === null ? 'X —  Y —' : `X ${formatNumber(point[0])} · Y ${formatNumber(point[1])} м`;

function CursorReadout(): React.JSX.Element {
  return <span className="canvas-status__cursor">{position(useSyncExternalStore(subscribe, () => cursor))}</span>;
}

/**
 * Status line over the bottom-left corner of the canvas: cursor in model
 * metres (the same numbers as the properties card), the selection with its
 * floor area and, while drawing, the segment from the last vertex to the
 * pointer. A drawing tool snaps the pointer, so while it draws the cursor is
 * the snapped point: the line promises what the click will do (D-224). Not
 * interactive.
 */
export function CanvasStatus({
  document: plan,
  session,
  draft,
  draftCursor,
}: {
  document: PlanDocument;
  session: EditorSession;
  /** Vertices placed so far, or null when nothing is being drawn. */
  draft: readonly Point[] | null;
  /** The snapped point under the pointer while drawing. */
  draftCursor: Point | null;
}): React.JSX.Element {
  const selected = useMemo(() => selectionReadout(plan, session), [plan, session]);
  const last = draft?.at(-1);
  const drawn = last === undefined || draftCursor === null ? null : segmentReadout(last, draftCursor);
  return (
    <div className="canvas-status" data-testid="canvas-status">
      {draftCursor === null ? <CursorReadout /> : <span className="canvas-status__cursor">{position(draftCursor)}</span>}
      {selected === null ? null : (
        <span>
          {selected.kind === 'zone' ? 'Зона' : `Выбрано: ${selected.count}`} · {formatArea(selected.area_m2)}
        </span>
      )}
      {drawn === null ? null : (
        <span>
          Отрезок {formatLength(drawn.length_m)} · {formatNumber(drawn.angle_deg, 1)}°
        </span>
      )}
    </div>
  );
}
