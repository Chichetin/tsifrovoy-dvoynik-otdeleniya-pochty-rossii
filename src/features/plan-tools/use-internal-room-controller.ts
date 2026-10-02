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
  const [name, setName] = useState(`Комната ${plan.zones.length + 1}`);
  const [typeId, setTypeId] = useState(plan.catalog.zoneTypes[0]?.id ?? '');
  const key = `${active}\0${plan.id}\0${epoch}`;
  const [context, setContext] = useState(key);
  if (context !== key) { setContext(key); setStart(null); setEnd(null); setReady(false); setName(`Комната ${plan.zones.length + 1}`); setTypeId(plan.catalog.zoneTypes[0]?.id ?? ''); }
  const cancel = useCallback(() => { setStart(null); setEnd(null); setReady(false); setNotice(null); }, []);
  const removeLast = useCallback(() => {
    if (ready) { setReady(false); setEnd(null); setNotice(null); }
    else cancel();
  }, [ready, cancel]);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextTarget(event.target)) {
        if (event.key === 'Escape' && event.target instanceof HTMLElement && event.target.closest('[data-room-controls]') !== null) {
          event.preventDefault(); event.stopImmediatePropagation(); cancel();
        }
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault(); event.stopImmediatePropagation();
        removeLast();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, removeLast, cancel]);
  const draft = start === null ? null : end === null ? [start] : roomRectangle(start, end);
  const candidate = ready && draft !== null ? createInternalRoom(plan, draft, session.retired, { name, typeId }) : null;
  const message = candidate !== null && !candidate.ok ? candidate.message : null;
  const apply = () => {
    if (!ready || draft === null) return;
    const result = createInternalRoom(plan, draft, session.retired, { name, typeId });
    if (!result.ok) { setNotice(result.message); return; }
    const applied = onCommand(result.command);
    if (applied.ok) { cancel(); setName(`Комната ${applied.value.zones.length + 1}`); }
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
  const corners = start === null ? [] : end === null ? [start] : [start, end];
  return { draft, corners, start, ready, message, valid: candidate?.ok === true, name, typeId, setName, setTypeId, apply, cancel, removeLast, handlePointer };
}
