/**
 * U03 (gesture): drawing a room boundary, a zone polygon, a partition or an
 * opening.
 *
 * A click adds a vertex; a click near the first vertex, Enter or a double click
 * closes the ring (D-262), and Escape throws the draft away. The document is only touched on closing — one
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
import type { Id, Point, Polygon } from '../../contracts/model';
import type { ToolController, ToolKind, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { defaultAttributes, findObjectType } from '../../domain/catalog';
import { nextFreeId, takenIds } from '../../domain/commands';
import { editableContentLayer } from '../../domain/content-layer';
import { SNAP, pointGuides, snapHint } from '../../domain/geometry';
import { getMeasurement, setMeasurement } from './measure';
import {
  DRAFT_SELF_INTERSECTION_NOTICE,
  NO_WALL_UNDER_POINTER_NOTICE,
  OPENING_WIDER_THAN_WALL_NOTICE,
  RING_TOO_FEW_POINTS_NOTICE,
  SHAPE_NO_TYPE_NOTICE,
  SHAPE_TOO_SMALL_NOTICE,
  WALL_TOO_SHORT_NOTICE,
  droppedOpeningNotice,
  setNotice,
} from './notice';
import { objectFromRing } from './object-shape';
import { setSnapHint } from './snap-marker';
import { isTextTarget } from './text-target';
import { canCommitRing, parentForRing, roundPoint } from './vertex-edit';
import { createOpening, createWall, nearestWall } from './wall-draft';

/** How close to the first vertex a click has to be to close the ring, in metres. */
const CLOSE_RADIUS_M = 0.4;

/** Tools whose draft is a ring: Enter and a double click close it. */
const RING_TOOLS: ReadonlySet<ToolKind> = new Set<ToolKind>(['room.draw', 'zone.draw', 'shape.draw']);

/** Konva puts its canvases into this container; a double click counts only there. */
const CANVAS_SELECTOR = '.konvajs-content';

/**
 * The draft without repeated vertices: a vertex within `tolerance` of the one
 * before it, and trailing vertices within `tolerance` of the first, are dropped.
 *
 * A double click arrives after two plain clicks, and each of them has already
 * added a vertex at almost the same place; without this the ring would carry a
 * zero-length edge. The earlier vertex of a pair is kept: that is the one the
 * user aimed and saw snap.
 */
export function withoutRepeatedVertices(vertices: readonly Point[], tolerance: number): Point[] {
  const near = (a: Point, b: Point): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
  const kept: Point[] = [];
  for (const vertex of vertices) {
    const previous = kept[kept.length - 1];
    if (previous !== undefined && near(previous, vertex)) continue;
    kept.push(vertex);
  }
  const first = kept[0];
  while (kept.length > 1 && first !== undefined && near(kept[kept.length - 1] as Point, first)) {
    kept.pop();
  }
  return kept;
}

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
  'shape.draw',
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
  const tool = session.tool;
  const kind = tool.kind;
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

  /**
   * «Своя фигура» (D-279): the drawn ring is a new object of the armed type,
   * its box the size, its centre the position, rotation 0 — everything else as
   * a library placement gives it. false keeps the draft on screen.
   */
  const drawShape = useCallback(
    (ring: Polygon, typeId: Id, taken: Set<Id>): boolean => {
      const type = findObjectType(plan.catalog, typeId);
      const layer =
        editableContentLayer(plan.layers) ?? plan.layers.find((entry) => entry.typeId === null);
      if (type === null || layer === undefined) {
        setNotice(SHAPE_NO_TYPE_NOTICE);
        return false;
      }
      const shaped = objectFromRing(
        {
          id: nextFreeId('eq_', taken),
          typeId: type.id,
          label: type.label,
          position: [0, 0],
          size_m: type.defaultSize_m,
          rotation_deg: 0,
          base_m: type.defaultBase_m,
          height_m: type.defaultHeight_m,
          zoneId: null,
          layerId: layer.id,
          attributes: defaultAttributes(type),
        },
        ring,
      );
      if (!shaped.ok) {
        setNotice(shaped.reason === 'too-small' ? SHAPE_TOO_SMALL_NOTICE : DRAFT_SELF_INTERSECTION_NOTICE);
        return false;
      }
      if (!onCommand({ type: 'object.put', object: shaped.object }).ok) return false;
      setNotice(null);
      return true;
    },
    [onCommand, plan.catalog, plan.layers],
  );

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
        if (tool.kind === 'shape.draw') return drawShape(ring, tool.typeId, taken);
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
    [drawShape, kind, onCommand, plan, session.retired, tool],
  );

  /**
   * Замыкание контура — один путь на все три жеста: клик по первой точке,
   * Enter и двойной клик (D-262). Повторы вершин снимаются, меньше трёх точек —
   * объяснение и черновик на месте, отказ `commit` — тоже черновик на месте.
   */
  const closeRing = useCallback(
    (vertices: readonly Point[]): void => {
      const ring = withoutRepeatedVertices(vertices, tolerance);
      if (ring.length < 3) {
        setDraft(ring.length === 0 ? null : ring);
        setNotice(RING_TOO_FEW_POINTS_NOTICE);
        return;
      }
      if (commit(ring)) {
        setDraft(null);
        setSnapHint(null);
        return;
      }
      setDraft(ring);
    },
    [commit, tolerance],
  );

  // Enter и двойной клик слушаются только пока контур рисуется: без черновика
  // Enter остаётся кнопке в фокусе, а двойной клик — холсту.
  const ringDraft = RING_TOOLS.has(kind) ? draft : null;
  useEffect(() => {
    if (ringDraft === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextTarget(event.target)) return;
      // Иначе тот же Enter нажал бы кнопку инструмента, оставшуюся в фокусе.
      event.preventDefault();
      closeRing(ringDraft);
    };
    const onDoubleClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest(CANVAS_SELECTOR) === null) return;
      // Последнюю точку уже поставили два клика двойного клика; дубль снимет closeRing.
      closeRing(ringDraft);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('dblclick', onDoubleClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dblclick', onDoubleClick);
    };
  }, [closeRing, ringDraft]);

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

      if (!RING_TOOLS.has(kind)) return;

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
        closeRing(current);
        return;
      }
      setDraft([...current, point]);
    },
    [closeRing, draft, drawWall, kind, measure, placeOpening, settle, showTarget],
  );

  return { handlePointer, cancel, draft };
};
