/**
 * U03 (shapes): the room, its zones, walls and openings.
 *
 * Everything here reads the document and draws it; nothing is stored. Zone
 * colour comes from the catalog, so a zone type added to data/catalog shows up
 * on the plan without a line of code changing.
 *
 * Nested zones are drawn deepest last: a waiting area inside a client area has
 * to stay visible and clickable, and its own fill must win.
 *
 * The selected shape grows handles: vertices of a ring, both ends of a wall,
 * the middle of an opening. A drag is one gesture and one command — the shape
 * follows the pointer locally and only the release dispatches `zone.put`,
 * `room.set`, `wall.put` or `opening.put`, so undo returns the whole gesture.
 * A ring dragged into a self-intersection is drawn red and never committed.
 *
 * Ctrl отдаёт контуру два жеста сверх этого (D-233): протяжка ребра вставляет
 * вершину под курсором и тянет из ребра выступ, клик по вершине её убирает.
 * Рёбра становятся перетаскиваемыми только пока клавиша нажата — без неё
 * жесты соседей по сцене (рамка выделения, панорама) остаются прежними.
 */

import { useEffect, useMemo, useState } from 'react';
import { Circle, Layer, Line, Text } from 'react-konva';
import type Konva from 'konva';
import type { Id, Opening, PlanDocument, Point, Polygon, Ref, Wall, Zone } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import type { PlanGeometryLayerProps } from '../../contracts/ui';
import { findZoneType } from '../../domain/catalog';
import {
  SNAP,
  type BoundingBox,
  boundingBox,
  footprint,
  modelToScreen,
  openingCentre,
  pointGuides,
  screenToModel,
  segmentLength,
  settlePoint,
  snapPoint,
  wallPolygon,
} from '../../domain/geometry';
import { zoneDepth } from '../../domain/relations';
import { SnapMarkerLayer } from './SnapMarkerLayer';
import { deleteIntent, isDeleteKey } from './delete-key';
import {
  DEGENERATE_RING_NOTICE,
  MIN_VERTICES_NOTICE,
  NEAR_VERTEX_NOTICE,
  SELF_INTERSECTION_NOTICE,
  droppedOpeningNotice,
  setNotice,
} from './notice';
import {
  HANDLE_RADIUS_PX,
  canCommitRing,
  insertVertex,
  insertionOnEdge,
  moveOpeningTo,
  moveVertex,
  moveWallEnd,
  removeVertexChecked,
  roundPoint,
  startEdgePull,
} from './vertex-edit';
import { zoneLabelAnchor } from './zone-label';

const ROOM_STROKE = '#212529';
const WALL_FILL = '#495057';
const OPENING_FILL = '#FFFFFF';
const DRAFT_STROKE = '#1971C2';
const SELECTED_STROKE = '#1971C2';
const INVALID_STROKE = '#E03131';
const HANDLE_FILL = '#FFFFFF';
const ZONE_FALLBACK = '#E9ECEF';
/**
 * Zone name style, deliberately unlike an object's caption (D-216): muted —
 * same grey as the app's `--color-muted` token, so it reads as a background
 * label, not a fact competing with the furniture on top of it — larger than
 * an object caption (11 px, `object-label.ts`), spaced and upper-case so the
 * two never look like the same kind of text on a crowded plan.
 */
const ZONE_LABEL_FILL = '#56626E';
const ZONE_LABEL_FONT_PX = 13;
const ZONE_LABEL_LETTER_SPACING = 0.4;
// Narrow enough that two neighbouring zones (a waiting area nested in the
// client hall, say) do not bleed into each other's name at the plan's usual
// zoom; a name too long for this wraps onto a second line on its own.
const ZONE_LABEL_BOX_WIDTH = 118;

/**
 * Жест выступа между `dragstart` и `dragend`: с какого кольца он начат, какая
 * вершина в него вставлена и каким кольцо стало к последнему движению. Живёт в
 * ref, а не в состоянии: Escape приходит посреди жеста, и решение «жест
 * отменён» должно пережить любой порядок событий Konva (тот же приём, что у
 * `gesture-guard` оборудования, D-101).
 */
type Pull = {
  ref: Ref;
  index: number;
  /** Кольцо со вставленной вершиной — основа всех движений жеста. */
  base: Polygon;
  polygon: Polygon;
  node: Konva.Node;
};

/**
 * Кадр жеста выступа и решение «жест отменён» — модульные переменные, а не
 * `useRef`: `draggable` ребра читается при отрисовке, а ref во время отрисовки
 * читать нельзя (`react-hooks/refs`). Тот же приём, что у `notice.ts` и
 * `snap-marker.ts` рядом. В документ, историю и файл отсюда не попадает
 * ничего: жест живёт ровно от нажатия до отпускания.
 *
 * Отмену держит эта переменная, а не узел: `stopDrag()` может позвать
 * `dragend` сразу, кадром позже или никогда, и поздний `dragend` не должен
 * превратить отменённый жест в команду (тот же урок, что у `gesture-guard`,
 * D-101).
 */
let pullGesture: Pull | null = null;
let pullCancelled = false;

type Editing =
  | { kind: 'ring'; ref: Ref; polygon: Polygon; snapOff?: boolean }
  | { kind: 'wall'; wall: Wall; snapOff?: boolean }
  | { kind: 'opening'; opening: Opening };

/** Typing in a field must not delete the selected zone. */
function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function flatten(polygon: Polygon, viewport: PlanGeometryLayerProps['session']['viewport']): number[] {
  return polygon.flatMap((point) => modelToScreen(point, viewport));
}

export function PlanGeometryLayer({
  document: plan,
  session,
  draft,
  onCommand,
  onSelect,
}: PlanGeometryLayerProps): React.JSX.Element {
  const { viewport, selection } = session;
  // While a drawing tool is active the click belongs to the tool: the shape
  // under the pointer must not steal the selection from what was just drawn,
  // and the handles of the selected shape must not catch the next vertex —
  // a T-junction on a neighbour's edge would insert a vertex instead.
  const picking = session.tool.kind === 'select' || session.tool.kind === 'pan';
  const pick = (ref: Ref): (() => void) | undefined => (picking ? () => onSelect(ref) : undefined);
  const [editing, setEditing] = useState<Editing | null>(null);
  const isSelected = (kind: string, id: Id): boolean =>
    selection?.kind === kind && selection.id === id;

  // One source for "which layers are on": zones, objects and labels must
  // follow the same visibility rule, so it is not rebuilt per consumer. Memoised
  // because the derived values below depend on it and must survive a pan frame.
  const visibleLayers = useMemo(
    () => new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [plan.layers],
  );
  const lockedLayers = new Set(
    plan.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );
  const zones: Zone[] = plan.zones
    .filter((zone) => visibleLayers.has(zone.layerId))
    .slice()
    .sort((a, b) => (zoneDepth(a.id, plan.zones) ?? 0) - (zoneDepth(b.id, plan.zones) ?? 0));

  // Footprints a zone name has to steer around (D-216). In model metres, not
  // screen pixels, so it is independent of pan and zoom — a pan or a zoom
  // re-renders this layer on every frame (D-190), and recomputing it from
  // `plan.objects` instead of the viewport keeps that frame cheap.
  const objectBoxes: BoundingBox[] = useMemo(
    () =>
      plan.objects
        .filter((object) => visibleLayers.has(object.layerId))
        .map((object) => boundingBox(footprint(object))),
    [plan.objects, visibleLayers],
  );

  // The anchors themselves are model metres too, and cost O(zones × objects) —
  // recomputing them inside the render below would pay that on every pan and
  // zoom frame for a result that cannot have changed.
  const zoneLabelAnchors = useMemo(
    () => new Map(plan.zones.map((zone) => [zone.id, zoneLabelAnchor(zone.polygon, objectBoxes)])),
    [plan.zones, objectBoxes],
  );

  // Delete and Backspace remove the selected zone, wall or opening; the room
  // stays, and objects belong to the equipment layer. What exactly the keys
  // remove — and when they refuse — is decided in delete-key.ts, the same rule
  // the toolbar button follows. The browser's "back" on Backspace is stopped
  // once the key is ours.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isDeleteKey(event.key) || isTextTarget(event.target)) return;
      const intent = deleteIntent(selection, plan);
      if (intent === null) return;
      event.preventDefault();
      if (intent.kind === 'refused') {
        setNotice(intent.notice);
        return;
      }
      const result = onCommand(intent.command);
      if (result.ok) {
        setNotice(null);
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCommand, onSelect, plan, selection]);

  // Ctrl в руках. Рёбра выбранного контура становятся перетаскиваемыми только
  // пока клавиша нажата (D-233): вне Ctrl нажатие на ребро остаётся тем же
  // кликом, что и раньше, и жесты соседей по сцене ничего не теряют. Клавишу
  // отпустили посреди выступа — жест всё равно свой, его держит `pull`.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  useEffect(() => {
    const sync = (event: KeyboardEvent): void => setCtrlHeld(event.ctrlKey || event.metaKey);
    const drop = (): void => setCtrlHeld(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    // Уход из окна (Alt+Tab) съедает keyup: иначе Ctrl остался бы «нажатым».
    window.addEventListener('blur', drop);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', drop);
    };
  }, []);

  // Тянут ли сейчас выступ — состоянием, потому что от этого зависит
  // отрисовка: начатый жест держит ребро перетаскиваемым и после того, как
  // Ctrl отпустили. Сам кадр жеста лежит в `pullGesture` выше.
  const [pulling, setPulling] = useState<Id | null>(null);

  // Escape посреди выступа отменяет его целиком: вставленная вершина уходит
  // вместе с жестом, документ и история его не видели. Обычную протяжку
  // вершины клавиша по-прежнему не трогает — там Escape принадлежит рисованию
  // (D-102), и обрывать на полпути нечего: вершина уже есть в контуре.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const started = pullGesture;
      if (started === null) return;
      pullGesture = null;
      pullCancelled = true;
      setPulling(null);
      setEditing(null);
      started.node.position({ x: 0, y: 0 });
      started.node.stopDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pointerWorld = (event: Konva.KonvaEventObject<unknown>): Point | null => {
    const position = event.target.getStage()?.getPointerPosition();
    if (position === undefined || position === null) return null;
    return screenToModel([position.x, position.y], viewport);
  };

  const nodeWorld = (node: Konva.Node): Point => screenToModel([node.x(), node.y()], viewport);

  /**
   * A dragged handle snaps to the plan's vertices and the grid (D-210) — to
   * every vertex but its own: `without` is the plan minus the thing being
   * dragged. Alt during the gesture keeps the handle under the pointer, and
   * the drop reuses what the last move saw.
   */
  const altOf = (evt: unknown): boolean =>
    typeof evt === 'object' && evt !== null && 'altKey' in evt && evt.altKey === true;
  /** Ctrl жеста правки контура; на Mac ту же роль играет Cmd (D-233). */
  const isCtrl = (evt: unknown): boolean =>
    typeof evt === 'object' &&
    evt !== null &&
    (('ctrlKey' in evt && evt.ctrlKey === true) || ('metaKey' in evt && evt.metaKey === true));
  const settleWorld = (raw: Point, snapOff: boolean, without: PlanDocument): Point => {
    if (snapOff) return roundPoint(raw);
    return settlePoint(snapPoint(raw, pointGuides(without), SNAP.grid_m, SNAP.tolerance_px / viewport.scale));
  };
  const handleWorld = (node: Konva.Node, snapOff: boolean, without: PlanDocument): Point =>
    settleWorld(nodeWorld(node), snapOff, without);
  const withoutVertex = (ref: Ref, polygon: Polygon, index: number): PlanDocument => {
    const rest = polygon.filter((_, at) => at !== index);
    if (ref.kind !== 'room') {
      return { ...plan, zones: plan.zones.map((zone) => (zone.id === ref.id ? { ...zone, polygon: rest } : zone)) };
    }
    // The outer walls meeting at this vertex move with it (D-134): their
    // faces at the old place are not something to snap back to.
    const vertex = polygon[index];
    const meets = (point: Point): boolean =>
      vertex !== undefined && segmentLength(point, vertex) <= TOLERANCE.coordinate_m;
    return {
      ...plan,
      room: { ...plan.room, boundary: rest },
      walls: plan.walls.filter((wall) => !meets(wall.from) && !meets(wall.to)),
    };
  };
  const withoutWall = (id: Id): PlanDocument => ({ ...plan, walls: plan.walls.filter((wall) => wall.id !== id) });

  const commitRing = (ref: Ref, polygon: Polygon): boolean => {
    if (!canCommitRing(polygon)) {
      setNotice(SELF_INTERSECTION_NOTICE);
      return false;
    }
    const zone = plan.zones.find((entry) => entry.id === ref.id);
    const result =
      ref.kind === 'room'
        ? onCommand({ type: 'room.set', boundary: polygon })
        : zone === undefined
          ? null
          : onCommand({ type: 'zone.put', zone: { ...zone, polygon } });
    // Правка контура помещения пересобирает наружные стены: проём, которому не
    // нашлось ребра, уходит вместе со стеной, и пропажу называют сразу (D-134).
    if (result?.ok === true) {
      setNotice(droppedOpeningNotice(plan.openings.length, result.value.openings.length));
    }
    return result?.ok === true;
  };

  /** Убрать вершину или объяснить, почему нельзя (D-233): одно правило на Ctrl+клик и двойной клик. */
  const removeRingVertex = (ref: Ref, polygon: Polygon, index: number): void => {
    const edit = removeVertexChecked(polygon, index);
    if (!edit.ok) {
      setNotice(edit.reason === 'min-vertices' ? MIN_VERTICES_NOTICE : DEGENERATE_RING_NOTICE);
      return;
    }
    commitRing(ref, edit.polygon);
  };

  /** Handles of the selected ring: drag moves, double click removes, edge click inserts. */
  const ringHandles = (ref: Ref, polygon: Polygon, editable: boolean): React.JSX.Element[] => {
    if (!editable) return [];
    // Handles sit on the document's vertices: the dragged one is moved by
    // Konva itself, and the preview ring is drawn separately.
    const edges = polygon.map((from, index) => {
      const to = polygon[(index + 1) % polygon.length]!;
      return (
        <Line
          key={`edge-${ref.id}-${index}`}
          name="ring-edge"
          points={flatten([from, to], viewport)}
          stroke="transparent"
          strokeWidth={1}
          hitStrokeWidth={HANDLE_RADIUS_PX * 2}
          // Тянуть ребро можно только с Ctrl; начатый выступ тянется и после
          // того, как клавишу отпустили, — иначе Konva оборвала бы свой же
          // жест на полпути (D-233).
          draggable={ctrlHeld || pulling === ref.id}
          onDragStart={(event) => {
            const point = pointerWorld(event);
            // Клавиша спрашивается у самого события, а не только у `ctrlHeld`:
            // keyup теряется при уходе из окна, и «залипший» Ctrl не должен
            // превращать чужую протяжку в выступ.
            const started = point === null || !isCtrl(event.evt) ? null : startEdgePull(polygon, point);
            if (started === null) {
              // Не с Ctrl и не по ребру: тянуть нечего, а уехавшая линия была
              // бы обманом — контур целиком этим жестом не двигается.
              event.target.stopDrag();
              event.target.position({ x: 0, y: 0 });
              return;
            }
            setNotice(null);
            pullCancelled = false;
            setPulling(ref.id);
            pullGesture = {
              ref,
              index: started.index,
              base: started.polygon,
              polygon: started.polygon,
              node: event.target,
            };
            setEditing({ kind: 'ring', ref, polygon: started.polygon });
          }}
          onDragMove={(event) => {
            const started = pullGesture;
            const raw = pointerWorld(event);
            if (started === null || raw === null) return;
            const snapOff = altOf(event.evt);
            // Привязка та же, что у ручки вершины (D-210): направляющие плана
            // без самой вытягиваемой вершины, Alt держит её под курсором.
            const point = settleWorld(raw, snapOff, withoutVertex(ref, started.base, started.index));
            const polygonNow = moveVertex(started.base, started.index, point);
            started.polygon = polygonNow;
            setEditing({ kind: 'ring', ref, polygon: polygonNow, snapOff });
          }}
          onDragEnd={(event) => {
            const started = pullGesture;
            pullGesture = null;
            setPulling(null);
            // Узел ребра возвращается на своё место: контур перерисует сам
            // документ, а отклонённый жест не должен оставлять линию сдвинутой.
            event.target.position({ x: 0, y: 0 });
            setEditing(null);
            if (started === null) return;
            if (pullCancelled) {
              pullCancelled = false;
              return;
            }
            commitRing(ref, started.polygon);
          }}
          onPointerClick={(event) => {
            const point = pointerWorld(event);
            if (point === null) return;
            // Полоса захвата ребра широкая, и у вершины она накрывает и
            // соседнее ребро, и саму ручку: клик у угла вершины не добавляет.
            const hit = insertionOnEdge(polygon, point);
            if (hit === null) {
              setNotice(NEAR_VERTEX_NOTICE);
              return;
            }
            commitRing(ref, insertVertex(polygon, hit.index, hit.point));
          }}
        />
      );
    });
    const vertices = polygon.map((vertex, index) => {
      const [x, y] = modelToScreen(vertex, viewport);
      return (
        <Circle
          key={`vertex-${ref.id}-${index}`}
          x={x}
          y={y}
          radius={HANDLE_RADIUS_PX / 2 + 1}
          hitStrokeWidth={HANDLE_RADIUS_PX}
          fill={HANDLE_FILL}
          stroke={SELECTED_STROKE}
          strokeWidth={1.5}
          draggable
          onDragStart={() => {
            setNotice(null);
            setEditing({ kind: 'ring', ref, polygon });
          }}
          onDragMove={(event) => {
            const snapOff = altOf(event.evt);
            const point = handleWorld(event.target, snapOff, withoutVertex(ref, polygon, index));
            setEditing({ kind: 'ring', ref, polygon: moveVertex(polygon, index, point), snapOff });
          }}
          onDragEnd={(event) => {
            const snapOff = editing?.kind === 'ring' ? (editing.snapOff ?? false) : altOf(event.evt);
            const moved = moveVertex(polygon, index, handleWorld(event.target, snapOff, withoutVertex(ref, polygon, index)));
            setEditing(null);
            // The node goes back to where the vertex was; a committed move
            // re-renders it at the new place, a refused one leaves it here.
            event.target.position({ x, y });
            commitRing(ref, moved);
          }}
          // Ctrl + клик по вершине убирает её (D-233); двойной клик делает то
          // же самое и остаётся для тех, кто уже к нему привык.
          onPointerClick={(event) => {
            if (!isCtrl(event.evt)) return;
            removeRingVertex(ref, polygon, index);
          }}
          onDblClick={() => removeRingVertex(ref, polygon, index)}
        />
      );
    });
    return [...edges, ...vertices];
  };

  const wallHandles = (wall: Wall): React.JSX.Element[] =>
    (['from', 'to'] as const).map((end) => {
      const [x, y] = modelToScreen(wall[end], viewport);
      return (
        <Circle
          key={`wall-${wall.id}-${end}`}
          x={x}
          y={y}
          radius={HANDLE_RADIUS_PX / 2 + 1}
          hitStrokeWidth={HANDLE_RADIUS_PX}
          fill={HANDLE_FILL}
          stroke={SELECTED_STROKE}
          strokeWidth={1.5}
          draggable
          onDragStart={() => setNotice(null)}
          onDragMove={(event) => {
            const snapOff = altOf(event.evt);
            const point = handleWorld(event.target, snapOff, withoutWall(wall.id));
            setEditing({ kind: 'wall', wall: moveWallEnd(wall, end, point), snapOff });
          }}
          onDragEnd={(event) => {
            const snapOff = editing?.kind === 'wall' ? (editing.snapOff ?? false) : altOf(event.evt);
            const moved = moveWallEnd(wall, end, handleWorld(event.target, snapOff, withoutWall(wall.id)));
            setEditing(null);
            event.target.position({ x, y });
            const result = onCommand({ type: 'wall.put', wall: moved });
            if (result.ok) setNotice(null);
          }}
        />
      );
    });

  const openingHandle = (opening: Opening, wall: Wall): React.JSX.Element => {
    const [x, y] = modelToScreen(openingCentre(opening, wall), viewport);
    return (
      <Circle
        key={`opening-${opening.id}`}
        x={x}
        y={y}
        radius={HANDLE_RADIUS_PX / 2 + 1}
        hitStrokeWidth={HANDLE_RADIUS_PX}
        fill={HANDLE_FILL}
        stroke={SELECTED_STROKE}
        strokeWidth={1.5}
        draggable
        onDragStart={() => setNotice(null)}
        onDragMove={(event) =>
          setEditing({
            kind: 'opening',
            opening: moveOpeningTo(opening, wall, nodeWorld(event.target)),
          })
        }
        onDragEnd={(event) => {
          const moved = moveOpeningTo(opening, wall, nodeWorld(event.target));
          setEditing(null);
          event.target.position({ x, y });
          const result = onCommand({ type: 'opening.put', opening: moved });
          if (result.ok) setNotice(null);
        }}
      />
    );
  };

  const ringShown = (ref: Ref, polygon: Polygon): { polygon: Polygon; invalid: boolean } => {
    if (editing?.kind !== 'ring' || editing.ref.id !== ref.id) return { polygon, invalid: false };
    return { polygon: editing.polygon, invalid: !canCommitRing(editing.polygon) };
  };

  const wallShown = (wall: Wall): Wall =>
    editing?.kind === 'wall' && editing.wall.id === wall.id ? editing.wall : wall;
  const openingShown = (opening: Opening): Opening =>
    editing?.kind === 'opening' && editing.opening.id === opening.id ? editing.opening : opening;

  const roomRef: Ref = { kind: 'room', id: plan.room.id };
  const room = ringShown(roomRef, plan.room.boundary);
  const draftInvalid = draft !== null && draft.length >= 3 && !canCommitRing(draft);

  const selectedZone =
    selection?.kind === 'zone' ? zones.find((zone) => zone.id === selection.id) : undefined;
  const selectedWall =
    selection?.kind === 'wall' ? plan.walls.find((wall) => wall.id === selection.id) : undefined;
  const selectedOpening =
    selection?.kind === 'opening'
      ? plan.openings.find((opening) => opening.id === selection.id)
      : undefined;
  const selectedOpeningWall =
    selectedOpening === undefined
      ? undefined
      : plan.walls.find((wall) => wall.id === selectedOpening.wallId);

  return (
    <>
    <Layer>
      <Line
        points={flatten(room.polygon, viewport)}
        closed
        fill="#F8F9FA"
        stroke={
          room.invalid ? INVALID_STROKE : isSelected('room', plan.room.id) ? SELECTED_STROKE : ROOM_STROKE
        }
        strokeWidth={2}
        onPointerClick={pick({ kind: 'room', id: plan.room.id })}
      />

      {zones.map((zone) => {
        const shown = ringShown({ kind: 'zone', id: zone.id }, zone.polygon);
        return (
          <Line
            key={zone.id}
            points={flatten(shown.polygon, viewport)}
            closed
            fill={findZoneType(plan.catalog, zone.typeId)?.color ?? ZONE_FALLBACK}
            opacity={0.75}
            // D-190: полупрозрачная заливка с обводкой иначе рисуется через
            // буферный холст размером со сцену — очистка и полная копия на
            // каждую зону при любой перерисовке слоя.
            perfectDrawEnabled={false}
            stroke={
              shown.invalid ? INVALID_STROKE : isSelected('zone', zone.id) ? SELECTED_STROKE : '#ADB5BD'
            }
            strokeWidth={isSelected('zone', zone.id) ? 2.5 : 1}
            onPointerClick={pick({ kind: 'zone', id: zone.id })}
          />
        );
      })}

      {zones.map((zone) => {
        // Centred by default; nudged just clear of whichever object sits
        // where the name would (D-216) — a rack row or a bench in the middle
        // of a zone is the common case, not an edge case.
        const anchor = zoneLabelAnchors.get(zone.id);
        if (anchor === undefined) return null;
        const [x, y] = modelToScreen(anchor, viewport);
        return (
          <Text
            key={`label-${zone.id}`}
            x={x - ZONE_LABEL_BOX_WIDTH / 2}
            y={y - ZONE_LABEL_FONT_PX / 2}
            width={ZONE_LABEL_BOX_WIDTH}
            align="center"
            text={zone.name.toLocaleUpperCase('ru')}
            fontSize={ZONE_LABEL_FONT_PX}
            fontStyle="500"
            letterSpacing={ZONE_LABEL_LETTER_SPACING}
            fill={ZONE_LABEL_FILL}
            listening={false}
          />
        );
      })}

      {plan.walls.map((wall) => (
        <Line
          key={wall.id}
          points={flatten(wallPolygon(wallShown(wall)), viewport)}
          closed
          fill={WALL_FILL}
          stroke={isSelected('wall', wall.id) ? SELECTED_STROKE : WALL_FILL}
          strokeWidth={isSelected('wall', wall.id) ? 2.5 : 1}
          onPointerClick={pick({ kind: 'wall', id: wall.id })}
        />
      ))}

      {plan.openings.map((entry) => {
        const opening = openingShown(entry);
        const wall = plan.walls.find((item) => item.id === opening.wallId);
        if (wall === undefined) return null;
        const shownWall = wallShown(wall);
        const length = Math.hypot(
          shownWall.to[0] - shownWall.from[0],
          shownWall.to[1] - shownWall.from[1],
        );
        if (length === 0) return null;
        const ux = (shownWall.to[0] - shownWall.from[0]) / length;
        const uy = (shownWall.to[1] - shownWall.from[1]) / length;
        const at = (along: number): Point => [
          shownWall.from[0] + ux * along,
          shownWall.from[1] + uy * along,
        ];
        return (
          <Line
            key={opening.id}
            points={flatten(
              [at(opening.offset_m), at(opening.offset_m + opening.width_m)],
              viewport,
            )}
            stroke={isSelected('opening', opening.id) ? SELECTED_STROKE : OPENING_FILL}
            strokeWidth={Math.max(3, shownWall.thickness_m * viewport.scale)}
            onPointerClick={pick({ kind: 'opening', id: opening.id })}
          />
        );
      })}

      {draft === null || draft.length === 0 ? null : (
        <Line
          points={flatten(draft, viewport)}
          stroke={draftInvalid ? INVALID_STROKE : DRAFT_STROKE}
          strokeWidth={2}
          dash={[6, 4]}
          closed={draft.length > 2}
          listening={false}
        />
      )}

      {picking && isSelected('room', plan.room.id) ? ringHandles(roomRef, plan.room.boundary, true) : null}
      {!picking || selectedZone === undefined
        ? null
        : ringHandles(
            { kind: 'zone', id: selectedZone.id },
            selectedZone.polygon,
            !lockedLayers.has(selectedZone.layerId),
          )}
      {!picking || selectedWall === undefined ? null : wallHandles(selectedWall)}
      {!picking || selectedOpening === undefined || selectedOpeningWall === undefined
        ? null
        : openingHandle(selectedOpening, selectedOpeningWall)}
    </Layer>
    {/* Маркер цели привязки — на своём слое: кадр жеста не должен
        перерисовывать зоны, стены и подписи (D-177, D-224). */}
    <SnapMarkerLayer viewport={viewport} />
    </>
  );
}
