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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Point, Polygon } from '../../contracts/model';
import type { ToolController, ToolKind, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { nextFreeId, takenIds } from '../../domain/commands';
import { editableContentLayer } from '../../domain/content-layer';
import { SNAP, pointGuides, snapHint } from '../../domain/geometry';
import { getMeasurement, setMeasurement } from './measure';
import {
  DRAFT_SELF_INTERSECTION_NOTICE,
  NO_WALL_UNDER_POINTER_NOTICE,
  OPENING_WIDER_THAN_WALL_NOTICE,
  WALL_TOO_SHORT_NOTICE,
  droppedOpeningNotice,
  setNotice,
} from './notice';
import { setSnapHint } from './snap-marker';
import { canCommitRing, parentForRing, roundPoint } from './vertex-edit';
import { createOpening, createWall, nearestWall } from './wall-draft';

/** How close to the first vertex a click has to be to close the ring, in metres. */
const CLOSE_RADIUS_M = 0.4;

/**
 * Tools that put a vertex where the pointer is, and therefore show what that
 * vertex would catch (D-224). An opening is not among them: it is placed on the
 * wall the click hits and does not snap at all (D-209), so promising a target
 * would be a lie.
 */
const DRAWING_TOOLS: ReadonlySet<ToolKind> = new Set<ToolKind>([
  'room.draw',
  'zone.draw',
  'wall.draw',
  // Линейка ставит точку туда же, куда её ставит рисование, и теми же
  // правилами привязки: измерение, начатое в сантиметре от угла, меряет не то,
  // что видит пользователь.
  'measure',
]);

export const usePlanToolController: UsePlanToolController = ({
  document: plan,
  session,
  onCommand,
}): ToolController => {
  const [draft, setDraft] = useState<Point[] | null>(null);
  const kind = session.tool.kind;
  const committing = useRef(false);
  const scale = session.viewport.scale;

  // Направляющие зависят только от плана, а спрашивают их на каждом движении
  // мыши: пересобирать их покадрово ради маркера незачем.
  const guides = useMemo(() => pointGuides(plan), [plan]);
  const tolerance = SNAP.tolerance_px / scale;

  // Маркер принадлежит текущему инструменту: сменили инструмент или ушли с
  // холста — подсказки нет (D-224). Измерение принадлежит линейке ровно так
  // же: с другим инструментом в руках отрезок на холсте нечем ни продолжить,
  // ни сбросить.
  useEffect(
    () => () => {
      setSnapHint(null);
      setMeasurement(null);
    },
    [kind],
  );

  // Открыли другой план — измерение прежнего с холста уходит: отрезок,
  // померенный по старым стенам, поверх нового плана читается как дефект.
  // План опознаётся по id и имени, как в `PlanTools.tsx`, а не по ссылке:
  // иначе измерение стирала бы любая правка плана.
  useEffect(() => {
    setMeasurement(null);
  }, [plan.id, plan.name]);

  const cancel = useCallback(() => {
    setDraft(null);
    setSnapHint(null);
    setMeasurement(null);
  }, []);

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

  /**
   * Куда сядет следующая точка и за что она зацепится — под курсором, до
   * клика (D-224). `Alt` выключает привязку, значит и обещать нечего.
   */
  const showTarget = useCallback(
    (event: WorldPointer): void => {
      if (event.alt || !DRAWING_TOOLS.has(kind)) {
        setSnapHint(null);
        return;
      }
      setSnapHint(snapHint(event.point, guides, SNAP.grid_m, tolerance));
    },
    [guides, kind, tolerance],
  );

  /**
   * Куда сядет точка жеста. То же правило, что у рисования (D-209, D-211): по
   * направляющим и сетке, `Alt` оставляет точку под курсором, остальное
   * хранится до сантиметра. Вынесено, потому что теперь по нему садятся и
   * вершина контура, и конец линейки, а два правила привязки в одном
   * редакторе — это две разные линейки.
   */
  const settle = useCallback(
    (event: WorldPointer): Point =>
      event.alt
        ? roundPoint(event.point)
        : snapHint(event.point, guides, SNAP.grid_m, tolerance).point,
    [guides, tolerance],
  );

  /**
   * Линейка: первый клик ставит начало, второй заканчивает измерение, третий
   * начинает новое. Пока измерение не закончено, второй конец идёт за
   * курсором. В документ отсюда не уходит ничего.
   */
  const measure = useCallback(
    (event: WorldPointer): void => {
      const current = getMeasurement();
      const point = settle(event);
      if (event.phase === 'move') {
        if (current === null || current.fixed) return;
        setMeasurement({ ...current, to: point });
        return;
      }
      if (current === null || current.fixed) {
        setMeasurement({ from: point, to: point, fixed: false });
        return;
      }
      setMeasurement({ ...current, to: point, fixed: true });
    },
    [settle],
  );

  const handlePointer = useCallback(
    (event: WorldPointer): void => {
      if (event.phase === 'cancel') {
        setDraft(null);
        setSnapHint(null);
        setMeasurement(null);
        return;
      }
      if (event.phase === 'move') {
        showTarget(event);
        if (kind === 'measure') measure(event);
        return;
      }
      if (event.phase !== 'down') return;

      if (kind === 'measure') {
        measure(event);
        return;
      }

      if (kind === 'opening.place') {
        placeOpening(event.point);
        return;
      }

      // A drawn vertex snaps to the plan's vertices and the grid (D-209);
      // Alt keeps the click where it was made. A guide-derived coordinate is
      // kept as the guide has it, the rest is stored to the centimetre
      // (operator №17, D-211). The opening above is not a vertex: it sits on
      // the wall the click hit.
      //
      // The same call the marker under the cursor is drawn from (D-224): what
      // was promised before the click is what the click does.
      const point = settle(event);

      if (kind === 'wall.draw') {
        const start = draft?.[0];
        // Первый клик запоминает начало, второй заканчивает перегородку.
        if (start === undefined) {
          setNotice(null);
          setDraft([point]);
          return;
        }
        if (drawWall(start, point)) {
          setDraft(null);
          setSnapHint(null);
        }
        return;
      }

      if (kind !== 'room.draw' && kind !== 'zone.draw') return;

      const current = draft ?? [];
      const first = current[0];
      // Closing is judged by where the click landed, not by where it snapped:
      // a click next to the first vertex may snap to the next grid node.
      const closes =
        current.length >= 3 &&
        first !== undefined &&
        Math.hypot(event.point[0] - first[0], event.point[1] - first[1]) <= CLOSE_RADIUS_M;

      if (closes) {
        // Отклонённый контур остаётся черновиком: пользователь дорисовывает
        // или отменяет его Escape, но нарисованное не пропадает молча.
        if (commit(current)) {
          setDraft(null);
          setSnapHint(null);
        }
        return;
      }
      setDraft([...current, point]);
    },
    [commit, draft, drawWall, kind, measure, placeOpening, settle, showTarget],
  );

  return { handlePointer, cancel, draft };
};
