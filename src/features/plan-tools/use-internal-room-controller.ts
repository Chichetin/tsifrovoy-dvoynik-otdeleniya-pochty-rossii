import { useCallback, useEffect, useState } from 'react';
import type { Point } from '../../contracts/model';
import type { UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { SNAP, pointGuides, snapHint } from '../../domain/geometry';
import { createInternalRoom, roomRectangle, snapRoomCorner } from './internal-room';
import { isTextTarget } from './text-target';
import { setNotice } from './notice';

export function useInternalRoomController({ document: plan, session, onCommand }: Parameters<UsePlanToolController>[0], active: boolean, epoch: number) {
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [ready, setReady] = useState(false);
  const key = `${active}\0${plan.id}\0${epoch}`;
  const [context, setContext] = useState(key);
  if (context !== key) { setContext(key); setStart(null); setEnd(null); setReady(false); }
  const cancel = useCallback(() => { setStart(null); setEnd(null); setReady(false); setNotice(null); }, []);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTextTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (ready) { setReady(false); setEnd(null); }
        else { setStart(null); setEnd(null); }
        setNotice(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, ready]);
  const draft = start === null ? null : end === null ? [start] : roomRectangle(start, end);
  const candidate = ready && draft !== null ? createInternalRoom(plan, draft, session.retired) : null;
  const message = candidate !== null && !candidate.ok ? candidate.message : null;
  const apply = () => {
    if (!ready || draft === null) return;
    const result = createInternalRoom(plan, draft, session.retired);
    if (!result.ok) { setNotice(result.message); return; }
    const applied = onCommand(result.command);
    if (applied.ok) cancel();
  };
  const handlePointer = (event: WorldPointer) => {
    if (!active) return;
    if (event.phase === 'cancel') { cancel(); return; }
    if (ready || (event.phase !== 'move' && event.phase !== 'down')) return;
    if (event.phase === 'down' && event.button !== 0) return;
    const point = event.alt ? event.point : snapRoomCorner(
      snapHint(event.point, pointGuides(plan), SNAP.grid_m, SNAP.tolerance_px / session.viewport.scale).point,
      plan.walls, SNAP.tolerance_px / session.viewport.scale,
    );
    if (event.phase === 'move') { if (start !== null) setEnd(point); return; }
    setNotice(null);
    if (start === null) { setStart(point); setEnd(null); }
    else { setEnd(point); setReady(true); }
  };
  return { draft, start, ready, message, valid: candidate?.ok === true, apply, cancel, handlePointer };
}
