/**
 * U03 (gesture): drawing a room boundary or a zone polygon.
 *
 * A click adds a vertex, a click near the first vertex closes the ring, and
 * Escape throws the draft away. The document is only touched on closing — one
 * gesture, one command, one undo step.
 *
 * A ring that crosses itself is refused here, before the command: the store
 * would accept it as a diagnosable state, and a plan nobody meant to draw is a
 * worse outcome than a refusal with the draft still on screen.
 */

import { useCallback, useRef, useState } from 'react';
import type { Id, Point, Polygon } from '../../contracts/model';
import type { ToolController, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { DRAFT_SELF_INTERSECTION_NOTICE, setNotice } from './notice';
import { canCommitRing, parentForRing } from './vertex-edit';

/** How close to the first vertex a click has to be to close the ring, in metres. */
const CLOSE_RADIUS_M = 0.4;

function nextId(prefix: string, taken: Set<Id>): Id {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const usePlanToolController: UsePlanToolController = ({
  document: plan,
  session,
  onCommand,
}): ToolController => {
  const [draft, setDraft] = useState<Point[] | null>(null);
  const kind = session.tool.kind;
  const committing = useRef(false);

  const cancel = useCallback(() => setDraft(null), []);

  /** Returns false when the ring was refused and the draft has to stay. */
  const commit = useCallback(
    (ring: Polygon): boolean => {
      if (committing.current) return false;
      if (!canCommitRing(ring)) {
        setNotice(DRAFT_SELF_INTERSECTION_NOTICE);
        return false;
      }
      committing.current = true;
      try {
        if (kind === 'room.draw') {
          onCommand({ type: 'room.set', boundary: ring });
          setNotice(null);
          return true;
        }
        const taken = new Set<Id>(plan.zones.map((zone) => zone.id));
        // Содержимое живёт только на обычных слоях: информационный слой рисует
        // поверх всего плана и ничего не содержит (D-063).
        const layer =
          plan.layers.find((entry) => !entry.locked && entry.typeId === null) ?? plan.layers[0];
        const zoneType = plan.catalog.zoneTypes[0];
        if (layer === undefined || zoneType === undefined) return false;
        const id = nextId('z_', taken);
        onCommand({
          type: 'zone.put',
          zone: {
            id,
            typeId: zoneType.id,
            name: `Зона ${plan.zones.length + 1}`,
            polygon: ring,
            // Вложенность берётся из геометрии: зона, нарисованная внутри
            // другой, принадлежит ей. Дальше родителя правят карточкой.
            parentId: parentForRing(ring, plan.zones),
            layerId: layer.id,
            attributes: {},
          },
        });
        setNotice(null);
        return true;
      } finally {
        committing.current = false;
      }
    },
    [kind, onCommand, plan.catalog.zoneTypes, plan.layers, plan.zones],
  );

  const handlePointer = useCallback(
    (event: WorldPointer): void => {
      if (event.phase === 'cancel') {
        setDraft(null);
        return;
      }
      if (kind !== 'room.draw' && kind !== 'zone.draw') return;
      if (event.phase !== 'down') return;

      const current = draft ?? [];
      const first = current[0];
      const closes =
        current.length >= 3 &&
        first !== undefined &&
        Math.hypot(event.point[0] - first[0], event.point[1] - first[1]) <= CLOSE_RADIUS_M;

      if (closes) {
        // Отклонённый контур остаётся черновиком: пользователь дорисовывает
        // или отменяет его Escape, но нарисованное не пропадает молча.
        if (commit(current)) setDraft(null);
        return;
      }
      setDraft([...current, event.point]);
    },
    [commit, draft, kind],
  );

  return { handlePointer, cancel, draft };
};
