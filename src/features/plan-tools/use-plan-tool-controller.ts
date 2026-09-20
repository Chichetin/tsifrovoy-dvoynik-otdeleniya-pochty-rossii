/**
 * U03 (gesture): drawing a room boundary, a zone polygon, a partition or an
 * opening.
 *
 * A click adds a vertex, a click near the first vertex closes the ring, and
 * Escape throws the draft away. The document is only touched on closing — one
 * gesture, one command, one undo step.
 *
 * A ring that crosses itself is refused here, before the command: the store
 * would accept it as a diagnosable state, and a plan nobody meant to draw is a
 * worse outcome than a refusal with the draft still on screen.
 *
 * Перегородка — это тот же черновик, только из двух точек: первый клик ставит
 * начало, второй заканчивает стену. Проём — один клик по стене. Оба отказа
 * (промах мимо стены, слишком короткий отрезок) объясняются строкой, а не
 * молчанием: клик, после которого ничего не произошло, читается как поломка.
 */

import { useCallback, useRef, useState } from 'react';
import type { Point, Polygon } from '../../contracts/model';
import type { ToolController, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { nextFreeId, takenIds } from '../../domain/commands';
import { editableContentLayer } from '../../domain/content-layer';
import { SNAP, pointGuides, snapPoint } from '../../domain/geometry';
import {
  DRAFT_SELF_INTERSECTION_NOTICE,
  NO_WALL_UNDER_POINTER_NOTICE,
  OPENING_WIDER_THAN_WALL_NOTICE,
  WALL_TOO_SHORT_NOTICE,
  droppedOpeningNotice,
  setNotice,
} from './notice';
import { canCommitRing, parentForRing } from './vertex-edit';
import { createOpening, createWall, nearestWall } from './wall-draft';

/** How close to the first vertex a click has to be to close the ring, in metres. */
const CLOSE_RADIUS_M = 0.4;

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
          // Новый контур пересобирает наружные стены: проём, которому не
          // нашлось ребра, уходит вместе со стеной — и об этом говорится сразу,
          // а не только находкой в панели «Проверка» (D-134).
          const result = onCommand({ type: 'room.set', boundary: ring });
          setNotice(
            result.ok
              ? droppedOpeningNotice(plan.openings.length, result.value.openings.length)
              : null,
          );
          return true;
        }
        // Plus ids retired by a delete this session: the store would refuse them (D-019).
        // One id space for the whole plan plus what a delete retired this session (D-198).
        const taken = takenIds(plan, session.retired);
        // Содержимое живёт только на обычных слоях: информационный слой рисует
        // поверх всего плана и ничего не содержит (D-063).
        // Every content layer locked: address the first one anyway, so the
        // store refuses with «слой заперт» instead of the click doing nothing.
        const layer =
          editableContentLayer(plan.layers) ?? plan.layers.find((entry) => entry.typeId === null);
        const zoneType = plan.catalog.zoneTypes[0];
        if (layer === undefined || zoneType === undefined) return false;
        const id = nextFreeId('z_', taken);
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
    [kind, onCommand, plan, session.retired],
  );

  /** Перегородка по двум точкам. false — отказ, начало остаётся на экране. */
  const drawWall = useCallback(
    (from: Point, to: Point): boolean => {
      const taken = takenIds(plan, session.retired);
      const wall = createWall(from, to, plan.room, taken);
      if (wall === null) {
        setNotice(WALL_TOO_SHORT_NOTICE);
        return false;
      }
      onCommand({ type: 'wall.put', wall });
      setNotice(null);
      return true;
    },
    [onCommand, plan, session.retired],
  );

  /** Проём на стене под курсором; мимо стены — объяснение, а не тишина. */
  const placeOpening = useCallback(
    (point: Point): void => {
      const hit = nearestWall(plan.walls, point);
      if (hit === null) {
        setNotice(NO_WALL_UNDER_POINTER_NOTICE);
        return;
      }
      const taken = takenIds(plan, session.retired);
      // Вид проёма правится карточкой свойств; ставим обычную дверь.
      const opening = createOpening(hit.wall, point, 'door', taken);
      if (opening === null) {
        setNotice(OPENING_WIDER_THAN_WALL_NOTICE);
        return;
      }
      onCommand({ type: 'opening.put', opening });
      setNotice(null);
    },
    [onCommand, plan, session.retired],
  );

  const handlePointer = useCallback(
    (event: WorldPointer): void => {
      if (event.phase === 'cancel') {
        setDraft(null);
        return;
      }
      if (event.phase !== 'down') return;

      if (kind === 'opening.place') {
        placeOpening(event.point);
        return;
      }

      // A drawn vertex snaps to the plan's vertices and the grid (D-209);
      // Alt keeps the click where it was made. The opening above is not a
      // vertex: it sits on the wall the click hit.
      const point = event.alt
        ? event.point
        : snapPoint(event.point, pointGuides(plan), SNAP.grid_m, SNAP.tolerance_px / session.viewport.scale).point;

      if (kind === 'wall.draw') {
        const start = draft?.[0];
        // Первый клик запоминает начало, второй заканчивает перегородку.
        if (start === undefined) {
          setNotice(null);
          setDraft([point]);
          return;
        }
        if (drawWall(start, point)) setDraft(null);
        return;
      }

      if (kind !== 'room.draw' && kind !== 'zone.draw') return;

      const current = draft ?? [];
      const first = current[0];
      const closes =
        current.length >= 3 &&
        first !== undefined &&
        Math.hypot(point[0] - first[0], point[1] - first[1]) <= CLOSE_RADIUS_M;

      if (closes) {
        // Отклонённый контур остаётся черновиком: пользователь дорисовывает
        // или отменяет его Escape, но нарисованное не пропадает молча.
        if (commit(current)) setDraft(null);
        return;
      }
      setDraft([...current, point]);
    },
    [commit, draft, drawWall, kind, placeOpening, plan, session.viewport.scale],
  );

  return { handlePointer, cancel, draft };
};
