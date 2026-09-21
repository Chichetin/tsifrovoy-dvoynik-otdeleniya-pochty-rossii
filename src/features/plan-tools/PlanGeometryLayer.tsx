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
 */

import { useEffect, useMemo, useState } from 'react';
import { Circle, Group, Layer, Line } from 'react-konva';
import type Konva from 'konva';
import type { Id, Opening, PlanDocument, Point, Polygon, Ref, Wall, Zone } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import type { PlanGeometryLayerProps } from '../../contracts/ui';
import { findZoneType } from '../../domain/catalog';
import {
  SNAP,
  boundingBox,
  modelToScreen,
  openingCentre,
  pointGuides,
  roomGridCoordinates,
  screenToModel,
  segmentLength,
  settlePoint,
  snapPoint,
  wallPolygon,
} from '../../domain/geometry';
import { zoneDepth } from '../../domain/relations';
import { SnapMarkerLayer } from './SnapMarkerLayer';
import { deleteIntent, isDeleteKey } from './delete-key';
import { currentExtrusion, endExtrusion, startExtrusion } from './extrude';
import {
  MIN_VERTICES_NOTICE,
  NEAR_VERTEX_NOTICE,
  SELF_INTERSECTION_NOTICE,
  droppedOpeningNotice,
  setNotice,
} from './notice';
import {
  HANDLE_RADIUS_PX,
  canCommitRing,
  extrudeEdge,
  insertVertex,
  insertionOnEdge,
  moveOpeningTo,
  moveVertex,
  moveWallEnd,
  removeVertex,
  roundPoint,
} from './vertex-edit';

const ROOM_STROKE = '#212529';
/** Сетка шага привязки: заметнее фоновой, но слабее любой линии плана (D-230). */
const ROOM_GRID_STROKE = '#CED4DA';
const WALL_FILL = '#495057';
const OPENING_FILL = '#FFFFFF';
const DRAFT_STROKE = '#1971C2';
const SELECTED_STROKE = '#1971C2';
const INVALID_STROKE = '#E03131';
const HANDLE_FILL = '#FFFFFF';
const ZONE_FALLBACK = '#E9ECEF';

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
  // Ctrl на Windows и Linux, Cmd на Mac: одна и та же правка контура.
  const ctrlOf = (evt: unknown): boolean =>
    typeof evt === 'object' &&
    evt !== null &&
    (('ctrlKey' in evt && evt.ctrlKey === true) || ('metaKey' in evt && evt.metaKey === true));
  const handleWorld = (node: Konva.Node, snapOff: boolean, without: PlanDocument): Point => {
    const raw = nodeWorld(node);
    if (snapOff) return roundPoint(raw);
    return settlePoint(snapPoint(raw, pointGuides(without), SNAP.grid_m, SNAP.tolerance_px / viewport.scale));
  };
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

  const dropVertex = (ref: Ref, polygon: Polygon, index: number): void => {
    const shrunk = removeVertex(polygon, index);
    if (shrunk === null) {
      setNotice(MIN_VERTICES_NOTICE);
      return;
    }
    commitRing(ref, shrunk);
  };

  /**
   * Handles of the selected ring: drag moves a vertex, Ctrl + click (or a
   * double click) removes it, a click on an edge inserts one, and Ctrl + drag
   * of an edge inserts and pulls it out in a single gesture (D-232).
   */
  const ringHandles = (ref: Ref, polygon: Polygon, editable: boolean): React.JSX.Element[] => {
    if (!editable) return [];
    // Handles sit on the document's vertices: the dragged one is moved by
    // Konva itself, and the preview ring is drawn separately.
    const edges = polygon.map((from, index) => {
      const to = polygon[(index + 1) % polygon.length]!;
      return (
        <Line
          key={`edge-${ref.id}-${index}`}
          points={flatten([from, to], viewport)}
          stroke="transparent"
          strokeWidth={1}
          hitStrokeWidth={HANDLE_RADIUS_PX * 2}
          draggable
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
          onDragStart={(event) => {
            // Тянуть ребро можно только с Ctrl: без него протяжка по холсту
            // остаётся панорамой и выделением, как была.
            const point = pointerWorld(event);
            const hit = point === null ? null : extrudeEdge(polygon, point);
            if (!ctrlOf(event.evt) || hit === null) {
              event.target.stopDrag();
              event.target.position({ x: 0, y: 0 });
              if (hit === null && ctrlOf(event.evt)) setNotice(NEAR_VERTEX_NOTICE);
              return;
            }
            setNotice(null);
            startExtrusion({ ref, index: hit.index, base: hit.polygon });
            setEditing({ kind: 'ring', ref, polygon: hit.polygon });
          }}
          onDragMove={(event) => {
            const pulled = currentExtrusion();
            if (pulled === null) return;
            const snapOff = altOf(event.evt);
            const raw = pointerWorld(event);
            if (raw === null) return;
            const point = snapOff
              ? roundPoint(raw)
              : settlePoint(
                  snapPoint(
                    raw,
                    pointGuides(withoutVertex(pulled.ref, pulled.base, pulled.index)),
                    SNAP.grid_m,
                    SNAP.tolerance_px / viewport.scale,
                  ),
                );
            setEditing({
              kind: 'ring',
              ref: pulled.ref,
              polygon: moveVertex(pulled.base, pulled.index, point),
              snapOff,
            });
          }}
          onDragEnd={(event) => {
            event.target.position({ x: 0, y: 0 });
            const pulled = endExtrusion();
            if (pulled === null) return;
            const shaped = editing?.kind === 'ring' ? editing.polygon : pulled.base;
            setEditing(null);
            commitRing(pulled.ref, shaped);
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
          onPointerClick={(event) => {
            // Ctrl + клик — то же, что двойной щелчок, но об этом написано в
            // подсказке инструмента: двойной щелчок сам себя не объясняет.
            if (!ctrlOf(event.evt)) return;
            event.cancelBubble = true;
            dropVertex(ref, polygon, index);
          }}
          onDblClick={() => dropVertex(ref, polygon, index)}
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

  // Сетка шага привязки на полу помещения (D-230): показывает узлы, к которым
  // тянется точка, и потому рисуется сразу над полом — под заливками зон,
  // стенами и оборудованием, чтобы ничего не загораживать.
  //
  // Координаты здесь без начала отсчёта: `modelToScreen` — это сдвиг на
  // `origin` плюс масштаб, и сдвиг вынесен в саму группу. Поэтому панорама
  // меняет только `x`/`y` группы и сотни линий при ней не пересобираются;
  // зум пересобирает — от масштаба они и зависят.
  // Сетка считается по сохранённому контуру, а не по редактируемому: пока
  // тянут угол помещения, пол под ним не должен дрожать, а зависимость от
  // стабильного пропа позволяет её мемоизировать.
  const boundary = plan.room.boundary;
  const roomGridLines = useMemo(() => {
    const scale = viewport.scale;
    const lines = roomGridCoordinates(boundary, SNAP.grid_m, scale);
    if (lines === null) return null;
    const box = boundingBox(boundary);
    return (
      <>
        {lines.xs.map((x) => (
          <Line
            key={`gx${x}`}
            points={[x * scale, -box.maxY * scale, x * scale, -box.minY * scale]}
            stroke={ROOM_GRID_STROKE}
            strokeWidth={1}
          />
        ))}
        {lines.ys.map((y) => (
          <Line
            key={`gy${y}`}
            points={[box.minX * scale, -y * scale, box.maxX * scale, -y * scale]}
            stroke={ROOM_GRID_STROKE}
            strokeWidth={1}
          />
        ))}
      </>
    );
  }, [boundary, viewport.scale]);

  // Обрезка по самому контуру, а не по его габариту: помещение бывает Г-образным.
  const roomGrid =
    roomGridLines === null ? null : (
      <Group
        x={viewport.origin[0]}
        y={viewport.origin[1]}
        listening={false}
        clipFunc={(context: Konva.Context) => {
          context.beginPath();
          boundary.forEach((point, index) => {
            const x = point[0] * viewport.scale;
            const y = -point[1] * viewport.scale;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
        }}
      >
        {roomGridLines}
      </Group>
    );
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

      {roomGrid}

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

      {/* Названия зон рисует `ZoneNameLayer` — отдельным слоем поверх
          оборудования, иначе объект, вставший на подпись, закрывает её
          целиком. Здесь их больше нет намеренно. */}

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
