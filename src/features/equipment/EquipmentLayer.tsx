/**
 * U04 (shapes and gestures): equipment on the plan.
 *
 * Size, symbol and colour come from the catalog, never from this file — that
 * is what makes a new equipment type appear on the plan after editing JSON.
 *
 * Move, rotate and resize are each one gesture and one command: the shape
 * follows the pointer locally and only the release dispatches `object.put`,
 * so undo returns the object to where it started rather than stepping back
 * through every frame. The arithmetic lives in transform.ts, the decision
 * whether a finished gesture reaches the store — in gesture-guard.ts; this
 * file only converts the pointer to world metres and draws the result.
 */

import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Label, Layer, Line, Rect, Tag, Text } from 'react-konva';
import Konva from 'konva';
import type { Equipment, Id, Point } from '../../contracts/model';
import type { EquipmentLayerProps } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { takenIds } from '../../domain/commands';
import { SNAP, footprint, modelToScreen, objectGuides, screenToModel, snapObjectCentre } from '../../domain/geometry';
import type { AxisSnap } from '../../domain/geometry';
import { planIndex } from '../../domain/plan-index';
import { createGestureGuard } from './gesture-guard';
import { equipmentHoverSummary } from './hover-summary';
import { LABEL_LINE_PX, objectLabel } from './object-label';
import { arrowDelta, marqueeHits, moveObjects, pasteObjects } from './selection-edit';
import {
  RESIZE_HANDLES,
  grabOffset,
  handlePoint,
  resizeFromPointer,
  rotationFromPointer,
  rotationHandlePoint,
  snapPosition,
  type ResizeHandle,
} from './transform';
import { isWallMounted } from './wall-mount';

const FALLBACK_COLOR = '#868E96';
const SELECTED_STROKE = '#1971C2';
/** Snap lines (operator 20.09 №3): a guide is the plan's own edge, the grid is a hint. */
const SNAP_GUIDE_STROKE = '#E64980';
const SNAP_GRID_STROKE = '#868E96';
const HANDLE_FILL = '#FFFFFF';
const ROTATE_FILL = '#E7F5FF';

/** Handles keep a screen size: a 10 cm object is still grabbable at any zoom. */
const HANDLE_RADIUS_PX = 6;
const ROTATION_GAP_PX = 28;
const HOVER_WIDTH_PX = 320;
const HOVER_GAP_PX = 14;

/**
 * What a move snapped to, for the eye (D-215): the world line the object's
 * edge landed on, per axis, and the stage size to draw it across.
 */
type SnapLines = { x: AxisSnap | null; y: AxisSnap | null; width: number; height: number };

/**
 * The object as the pointer is currently shaping it; null outside a gesture.
 * `delta` is set while a member of a group is dragged: the other members
 * follow by the same offset in model metres, from their own positions.
 * `lines` — what the move snapped to, drawn on the selection layer.
 */
type Gesture = { id: string; object: Equipment; delta?: Point; lines?: SnapLines };

/**
 * A marquee in progress, in stage pixels. `width`/`height` are the stage's:
 * while the marquee runs, a transparent rectangle that size sits on top so the
 * release lands on it, not on the floor — Konva fires `click` only when the
 * shape under the release is the one under the press, so the zone or the room
 * under the marquee does not get picked after it.
 */
type Marquee = { from: Point; to: Point; width: number; height: number; shift: boolean };

/** Pixels the pointer must travel from the press before it is a marquee. */
const MARQUEE_START_PX = 4;

const NO_GROUP: ReadonlySet<Id> = new Set<Id>();

/**
 * Буфер копирования: снимок объектов на момент Ctrl+C и счётчик вставок из
 * него подряд. Снимок, а не ссылки: оригинал можно подвинуть или удалить, а
 * вставится то, что копировали. Живёт в слое и не переживает перезагрузку —
 * это не содержимое документа.
 */
type Clipboard = { objects: Equipment[]; pastes: number };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

type EquipmentSymbolProps = {
  symbol: string | undefined;
  width: number;
  height: number;
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
};

/**
 * The catalog symbol as a Konva shape centred on its group's origin; no behaviour.
 * Memoised on its primitive props: react-konva repaints a whole layer as soon as
 * one node gets a "new" prop, and a `points` array built on every render is
 * always new. With the memo a click elsewhere leaves a thousand shapes untouched.
 * `perfectDrawEnabled: false` (D-187): a translucent shape with fill and stroke
 * is otherwise painted through a stage-sized buffer canvas — one clear and one
 * full-canvas copy per object on every redraw of the layer (zoom, pan, drag,
 * open). Before/after numbers: docs/verification/performance-2026-09-19-d187.md.
 */
const EquipmentSymbol = memo(function EquipmentSymbol({
  symbol,
  width,
  height,
  ...style
}: EquipmentSymbolProps): React.JSX.Element {
  const paint = { ...style, perfectDrawEnabled: false };
  if (symbol === 'circle') {
    return <Circle radius={Math.max(width, height) / 2} {...paint} />;
  }
  if (symbol === 'triangle') {
    return (
      <Line
        points={[0, -height / 2, width / 2, height / 2, -width / 2, height / 2]}
        closed
        {...paint}
      />
    );
  }
  return <Rect width={width} height={height} offsetX={width / 2} offsetY={height / 2} {...paint} />;
});

export function EquipmentLayer({
  document: plan,
  session,
  issues = [],
  onCommand,
  onSelect,
  onSelectMany,
  preview,
  onGesturePreview,
}: EquipmentLayerProps): React.JSX.Element {
  const { viewport, selection } = session;
  const names = useMemo(() => planIndex(plan), [plan]);
  // A click while a drawing or placing tool is active belongs to that tool:
  // the object under the pointer must not take the selection away from the one
  // just placed, and the handles of the selected object must not swallow the
  // next placement click (stacking racks from the library is the normal case).
  const picking = session.tool.kind === 'select' || session.tool.kind === 'pan';
  const [gesture, setGesture] = useState<Gesture | null>(null);
  // Lazy initialiser: one guard per layer, kept across renders. It holds the
  // gesture in progress — the dragged node, where it started and where inside
  // the handle it was grabbed.
  const [guard] = useState(createGestureGuard);

  const visibleLayers = new Set(
    plan.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );
  const lockedLayers = new Set(
    plan.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );

  const selectedObject =
    selection?.kind === 'object'
      ? (plan.objects.find((object) => object.id === selection.id) ?? null)
      : null;
  const selectedVisible = selectedObject !== null && visibleLayers.has(selectedObject.layerId);
  const selectedLocked = selectedObject !== null && lockedLayers.has(selectedObject.layerId);
  // Настенный прибор (D-228) не растягивают: его габариты — свойство изделия,
  // а не решение планировщика. Ручки размера ему не показываются, поворот и
  // перенос остаются. Признак — из справочника, не список типов здесь.
  const selectedFixedSize =
    selectedObject !== null && isWallMounted(findObjectType(plan.catalog, selectedObject.typeId));
  // On a thin or short object, 6 px handles from opposite sides overlap its
  // centre. The top selection layer then catches a drag meant to move the
  // object and turns it into a resize. Moving is the primary gesture; exact
  // dimensions remain available in the properties card at every zoom.
  const selectedHasRoomForResizeHandles =
    selectedObject !== null &&
    Math.min(selectedObject.size_m[0], selectedObject.size_m[1]) * viewport.scale >=
      HANDLE_RADIUS_PX * 2 + 6;
  const clipboard = useRef<Clipboard | null>(null);

  // The group (marquee, Shift+click): visible members only, the primary among
  // them. One member is the ordinary single selection; two or more make the
  // keys, the drag and Delete act on all of them, as one command each.
  const group = session.selected ?? NO_GROUP;
  const members = plan.objects.filter(
    (object) => group.has(object.id) && visibleLayers.has(object.layerId),
  );
  const isGroup = members.length > 1;
  // A locked layer neither drags nor moves by key; its members stay put.
  const movable = members.filter((object) => !lockedLayers.has(object.layerId));
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const press = useRef<{ from: Point; shift: boolean } | null>(null);
  const layerRef = useRef<Konva.Layer>(null);
  // Konva nodes live in state so event callbacks can update them without a
  // React render on every pointer move. They are assigned once on mount.
  const [hoverLabel, setHoverLabel] = useState<Konva.Label | null>(null);
  const [hoverText, setHoverText] = useState<Konva.Text | null>(null);
  const put = (object: Equipment) => ({ type: 'object.put', object }) as const;

  // The channel outlives this layer in App; never leave a stale frame behind.
  useEffect(() => () => onGesturePreview?.(null), [onGesturePreview]);

  // The marquee listens on the stage: a press on the floor, a zone, the grid
  // or the empty stage may begin one; a press on an object, a handle or any
  // draggable node belongs to that node's own gesture. Rubber-banding is the
  // «Выбор» tool's job only — under a drawing or placing tool the press draws.
  useEffect(() => {
    const stage = layerRef.current?.getStage();
    if (!stage || onSelectMany === undefined) return;

    const onDown = (event: Konva.KonvaEventObject<PointerEvent>): void => {
      press.current = null;
      if (session.tool.kind !== 'select' || event.evt.button !== 0) return;
      const layerName = event.target.getLayer()?.name();
      if (layerName === 'equipment' || layerName === 'equipment-selection') return;
      if (event.target !== stage && event.target.draggable()) return;
      const position = stage.getPointerPosition();
      if (position === null) return;
      press.current = { from: [position.x, position.y], shift: event.evt.shiftKey };
    };
    const onMove = (): void => {
      const start = press.current;
      if (start === null) return;
      // A drag that began meanwhile (a zone vertex, a wall end) owns the pointer.
      if (Konva.isDragging()) {
        press.current = null;
        return;
      }
      const position = stage.getPointerPosition();
      if (position === null) return;
      const to: Point = [position.x, position.y];
      if (
        marquee === null &&
        Math.abs(to[0] - start.from[0]) < MARQUEE_START_PX &&
        Math.abs(to[1] - start.from[1]) < MARQUEE_START_PX
      ) {
        return;
      }
      setMarquee({ from: start.from, to, width: stage.width(), height: stage.height(), shift: start.shift });
    };
    const onUp = (): void => {
      press.current = null;
      if (marquee === null) return;
      setMarquee(null);
      // Hidden and locked layers are out of reach for a group edit, so their
      // objects do not get caught: the person would see a count that the
      // next arrow key does not match.
      const reachable = plan.objects.filter(
        (object) => visibleLayers.has(object.layerId) && !lockedLayers.has(object.layerId),
      );
      const hits = marqueeHits(
        reachable,
        screenToModel(marquee.from, viewport),
        screenToModel(marquee.to, viewport),
      );
      // Shift adds to what is already picked; a plain marquee replaces it.
      onSelectMany(marquee.shift ? [...group.values(), ...hits] : hits);
    };

    stage.on('pointerdown.marquee', onDown);
    stage.on('pointermove.marquee', onMove);
    stage.on('pointerup.marquee', onUp);
    return () => {
      stage.off('pointerdown.marquee');
      stage.off('pointermove.marquee');
      stage.off('pointerup.marquee');
    };
  });

  // Escape drops a marquee in progress: nothing was picked, nothing changes.
  useEffect(() => {
    if (marquee === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      press.current = null;
      setMarquee(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marquee]);

  // Escape mid-gesture puts the shape back and drops the command. Only this
  // layer's own gesture is touched — a vertex or a wall end being dragged
  // elsewhere on the stage belongs to its own layer. The guard, not the node,
  // remembers the cancellation, so a `dragend` that arrives later (or never)
  // cannot turn it into a command.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const cancelled = guard.cancel();
      if (cancelled === null) return;
      setGesture(null);
      onGesturePreview?.(null);
      cancelled.node.position(cancelled.origin);
      cancelled.node.stopDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guard, onGesturePreview]);

  // Delete removes what the user sees selected; a hidden object is out of reach,
  // and a key pressed inside a field belongs to that field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (isTypingTarget(event.target)) return;
      if (selectedObject === null || !selectedVisible) return;
      event.preventDefault();
      // A group goes in one batch: one Delete, one «Отменить» brings all back.
      onCommand(
        isGroup
          ? { type: 'batch', commands: members.map((object) => ({ type: 'object.delete', id: object.id })) }
          : { type: 'object.delete', id: selectedObject.id },
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Клавиатурная правка выбранного: стрелки двигают на шаг, Shift+стрелка — на
  // мелкий, Ctrl+C/Ctrl+V копируют и вставляют со смещением. Одно нажатие —
  // одна команда, поэтому «Отменить» возвращает объект туда, где он был до
  // нажатия, а не отыгрывает кадры.
  //
  // Клавиша, нажатая в поле карточки, принадлежит полю: стрелками там ходят по
  // тексту, Ctrl+C копирует текст (находка operator №18). Сочетания проверяются
  // по `code`, а не по букве: на русской раскладке Ctrl+C — это «Ctrl+С»
  // кириллицей, и по `key` горячая клавиша пропала бы.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const combo = event.ctrlKey || event.metaKey;

      // Вставка выделения не требует: буфер держит снимок, и «скопировал →
      // удалил оригинал → вставил» обязан работать, хотя выбирать уже нечего.
      if (combo && event.code === 'KeyV') {
        const buffer = clipboard.current;
        if (buffer === null) return;
        event.preventDefault();
        // Свободные номера считаются и по плану, и по удалённым в этой сессии
        // id (D-156): иначе первая же вставка после удаления ляжет на
        // retired-id и команда откажет ID_REUSED.
        const taken = takenIds(plan, session.retired);
        const copies = pasteObjects(buffer.objects, taken, buffer.pastes + 1);
        // Одним пакетом: вставка группы — одна правка и одно «Отменить».
        if (copies.length === 0 || !onCommand({ type: 'batch', commands: copies.map(put) }).ok) return;
        buffer.pastes += 1;
        // Вставленное сразу выбрано: карточка показывает копию, и следующая
        // стрелка двигает именно её (D-147). Группа вставляется группой.
        const last = copies.at(-1);
        if (copies.length > 1 && onSelectMany !== undefined) {
          onSelectMany(copies.map((copy) => copy.id));
        } else if (last !== undefined) {
          onSelect({ kind: 'object', id: last.id });
        }
        return;
      }

      // Всё остальное правит выбранное — и только то, что видно на плане.
      if (selectedObject === null || !selectedVisible) return;

      if (combo) {
        if (event.code !== 'KeyC') return;
        event.preventDefault();
        clipboard.current = { objects: isGroup ? members : [selectedObject], pastes: 0 };
        return;
      }

      if (event.altKey) return;
      const delta = arrowDelta(event.key, event.shiftKey);
      if (delta === null) return;
      // Заблокированный слой не тянется мышью — не двигается и стрелками.
      const moving = isGroup ? movable : selectedLocked ? [] : [selectedObject];
      if (moving.length === 0) return;
      event.preventDefault();
      const moved = moveObjects(moving, delta);
      const [single] = moved;
      onCommand(
        isGroup || single === undefined ? { type: 'batch', commands: moved.map(put) } : put(single),
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** The pointer in world metres, through the one conversion in domain/geometry. */
  const worldPointer = (event: Konva.KonvaEventObject<unknown>): Point | null => {
    const position = event.target.getStage()?.getPointerPosition();
    if (position === undefined || position === null) return null;
    return screenToModel([position.x, position.y], viewport);
  };

  const setCursor = (event: Konva.KonvaEventObject<MouseEvent>, cursor: string): void => {
    const container = event.target.getStage()?.container();
    if (container !== undefined) container.style.cursor = cursor;
  };

  const hideHover = (): void => {
    const label = hoverLabel;
    if (label === null || !label.visible()) return;
    label.hide();
    label.getLayer()?.batchDraw();
  };

  /** Imperative on purpose: hovering must not reconcile a thousand object nodes. */
  const showHover = (event: Konva.KonvaEventObject<MouseEvent>, object: Equipment): void => {
    if (Konva.isDragging()) {
      hideHover();
      return;
    }
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    const label = hoverLabel;
    const text = hoverText;
    if (stage === null || stage === undefined || pointer === null || pointer === undefined || text === null || label === null) return;
    const summary = equipmentHoverSummary(names, shown(object), issues);
    text.text([summary.title, ...summary.lines].join('\n'));
    const height = text.height();
    const left = Math.min(pointer.x + HOVER_GAP_PX, Math.max(0, stage.width() - HOVER_WIDTH_PX));
    const below = pointer.y + HOVER_GAP_PX;
    const top = below + height <= stage.height()
      ? below
      : Math.max(0, pointer.y - height - HOVER_GAP_PX);
    label.position({ x: left, y: top });
    label.show();
    label.moveToTop();
    label.getLayer()?.batchDraw();
  };

  /**
   * Start of every gesture: select what is being pulled, remember where from.
   * Guides are computed once here, without the objects being moved, so a
   * thing never snaps to itself (D-208).
   */
  const beginGesture = (
    event: Konva.KonvaEventObject<unknown>,
    id: string,
    grab: Point = [0, 0],
  ): void => {
    const node = event.target;
    // Locked members of a group stay put, so they remain something to snap to.
    const moving = isGroup && group.has(id) ? new Set<Id>(movable.map((member) => member.id)) : new Set<Id>([id]);
    guard.begin({ node, origin: { x: node.x(), y: node.y() }, grab, guides: objectGuides(plan, moving) });
    // Grabbing a member keeps the group and makes that member the primary —
    // the card follows the hand; anything else is a single pick.
    if (isGroup && group.has(id) && onSelectMany !== undefined) {
      onSelectMany([...[...group.values()].filter((member) => member !== id), id]);
    } else {
      onSelect({ kind: 'object', id });
    }
  };

  /** How far the handle was grabbed from its centre; zero outside a gesture. */
  const grabOf = (): Point => guard.started?.grab ?? [0, 0];

  /** One put per finished gesture; a cancelled or refused one snaps the handle back. */
  const commit = (
    node: Konva.Node,
    next: Equipment,
    handleAfter: (object: Equipment) => Point,
    before: Point,
  ): void => {
    setGesture(null);
    onGesturePreview?.(null);
    const accepted = guard.finish() && onCommand({ type: 'object.put', object: next }).ok;
    const [x, y] = modelToScreen(accepted ? handleAfter(next) : before, viewport);
    node.position({ x, y });
  };

  const shown = (object: Equipment): Equipment => {
    if (gesture === null) return object;
    if (gesture.id === object.id) return gesture.object;
    if (gesture.delta === undefined || !group.has(object.id) || lockedLayers.has(object.layerId)) {
      return object;
    }
    const [dx, dy] = gesture.delta;
    return { ...object, position: [object.position[0] + dx, object.position[1] + dy] };
  };

  /** Offset of a dragged member from where it started, in model metres. */
  const groupDelta = (object: Equipment, next: Equipment): Point | undefined =>
    isGroup && group.has(object.id)
      ? [next.position[0] - object.position[0], next.position[1] - object.position[1]]
      : undefined;

  /** One batch per finished group drag; refused, every member snaps back. */
  const commitGroup = (node: Konva.Node, dragged: Equipment, next: Equipment): void => {
    setGesture(null);
    onGesturePreview?.(null);
    const delta = groupDelta(dragged, next) ?? [0, 0];
    const moved = moveObjects(
      movable.filter((object) => object.id !== dragged.id),
      delta,
    );
    const accepted =
      guard.finish() && onCommand({ type: 'batch', commands: [next, ...moved].map(put) }).ok;
    const [x, y] = modelToScreen(accepted ? next.position : dragged.position, viewport);
    node.position({ x, y });
  };

  const render = (object: Equipment, ghost: boolean): React.JSX.Element => {
    const type = findObjectType(plan.catalog, object.typeId);
    const current = shown(object);
    const [x, y] = modelToScreen(current.position, viewport);
    // Alt during the drag turns snapping off (D-208). The drop reuses what the
    // last move saw: a key released a moment before the button must not make
    // the object jump at release.
    const movedTo = (
      node: Konva.Node,
      evt: unknown,
      phase: 'move' | 'drop',
    ): { position: Point; lines?: SnapLines } => {
      const centre = screenToModel([node.x(), node.y()], viewport);
      const started = guard.started;
      if (phase === 'move' && started !== null) {
        started.snapOff = typeof evt === 'object' && evt !== null && 'altKey' in evt && evt.altKey === true;
      }
      const guides = started?.guides;
      if (started?.snapOff === true || guides === undefined) return { position: snapPosition(centre) };
      // Already settled by the domain: a guide axis keeps the guide's own
      // millimetres, rounding it to the centimetre would push it into the wall.
      const snapped = snapObjectCentre(object, centre, guides, SNAP.grid_m, SNAP.tolerance_px / viewport.scale);
      const stage = node.getStage();
      const lines: SnapLines | undefined =
        stage === null || (snapped.snap.x === null && snapped.snap.y === null)
          ? undefined
          : { x: snapped.snap.x, y: snapped.snap.y, width: stage.width(), height: stage.height() };
      return { position: snapped.centre, lines };
    };

    return (
      <Group
        key={object.id}
        name={`equipment-${object.id}`}
        x={x}
        y={y}
        // Konva rotates clockwise on a Y-down canvas, which matches the model's
        // clockwise convention without a sign flip here.
        rotation={current.rotation_deg}
        draggable={!ghost && !lockedLayers.has(object.layerId)}
        listening={!ghost}
        onPointerClick={
          picking
            ? (event) => {
                // Shift+click adds to or removes from the group; a plain click
                // picks this object alone.
                if (event.evt.shiftKey && onSelectMany !== undefined) {
                  const others = [...group.values()].filter((member) => member !== object.id);
                  onSelectMany(group.has(object.id) ? others : [...others, object.id]);
                } else {
                  onSelect({ kind: 'object', id: object.id });
                }
              }
            : undefined
        }
        onDragStart={(event) => {
          hideHover();
          beginGesture(event, object.id);
          onGesturePreview?.({ objectId: object.id, position: object.position });
        }}
        onMouseEnter={(event) => {
          setCursor(event, lockedLayers.has(object.layerId) ? 'default' : 'grab');
          showHover(event, object);
        }}
        onMouseMove={(event) => showHover(event, object)}
        onMouseLeave={(event) => {
          setCursor(event, 'default');
          hideHover();
        }}
        onDragMove={(event) => {
          const moved = movedTo(event.target, event.evt, 'move');
          const next = { ...object, position: moved.position };
          onGesturePreview?.({ objectId: object.id, position: next.position });
          setGesture({ id: object.id, object: next, delta: groupDelta(object, next), lines: moved.lines });
        }}
        onDragEnd={(event) => {
          const next = { ...object, position: movedTo(event.target, event.evt, 'drop').position };
          if (isGroup && group.has(object.id)) {
            commitGroup(event.target, object, next);
            return;
          }
          // A refused move must not leave the shape where the pointer dropped it.
          commit(event.target, next, (result) => result.position, object.position);
        }}
      >
        <EquipmentSymbol
          symbol={type?.symbol}
          width={current.size_m[0] * viewport.scale}
          height={current.size_m[1] * viewport.scale}
          fill={type?.color ?? FALLBACK_COLOR}
          opacity={ghost ? 0.45 : 0.9}
          // Selection is drawn on its own layer below: a shape that depends on
          // `selection` would make every click repaint all thousand of them.
          stroke="#343A40"
          strokeWidth={1}
        />
      </Group>
    );
  };

  const renderResizeHandle = (object: Equipment, handle: ResizeHandle): React.JSX.Element => {
    const current = shown(object);
    const [x, y] = modelToScreen(handlePoint(current, handle), viewport);
    return (
      <Circle
        key={`resize-${handle.id}`}
        name={`handle-resize-${handle.id}`}
        x={x}
        y={y}
        radius={HANDLE_RADIUS_PX}
        fill={HANDLE_FILL}
        stroke={SELECTED_STROKE}
        strokeWidth={1.5}
        draggable
        onMouseEnter={(event) => setCursor(event, 'crosshair')}
        onMouseLeave={(event) => setCursor(event, 'default')}
        onPointerDown={(event) => {
          // The stage must not read this press as a tool click.
          event.cancelBubble = true;
          // The press rarely lands on the handle's centre, and the side must
          // grow by what the pointer travels, not by where it grabbed. The
          // offset is taken here, at the press: by the time Konva fires
          // dragstart the pointer has already passed its drag threshold.
          const pointer = worldPointer(event);
          beginGesture(event, object.id, pointer === null ? [0, 0] : grabOffset(object, handle, pointer));
        }}
        onDragStart={() => onSelect({ kind: 'object', id: object.id })}
        onDragMove={(event) => {
          const pointer = worldPointer(event);
          if (pointer === null) return;
          setGesture({
            id: object.id,
            object: { ...object, ...resizeFromPointer(object, handle, pointer, grabOf()) },
          });
        }}
        onDragEnd={(event) => {
          const pointer = worldPointer(event);
          const next =
            pointer === null
              ? (gesture?.object ?? object)
              : { ...object, ...resizeFromPointer(object, handle, pointer, grabOf()) };
          commit(
            event.target,
            next,
            (result) => handlePoint(result, handle),
            handlePoint(object, handle),
          );
        }}
      />
    );
  };

  const renderRotationHandle = (object: Equipment): React.JSX.Element => {
    const current = shown(object);
    const gap_m = ROTATION_GAP_PX / viewport.scale;
    const [x, y] = modelToScreen(rotationHandlePoint(current, gap_m), viewport);
    const front = RESIZE_HANDLES.find((handle) => handle.id === 'n') as ResizeHandle;
    const [fx, fy] = modelToScreen(handlePoint(current, front), viewport);
    const turned = (pointer: Point, shift: boolean): Equipment => ({
      ...object,
      rotation_deg: rotationFromPointer(object.position, pointer, shift, object.rotation_deg),
    });
    return (
      <Fragment key="rotate">
        <Line
          points={[fx, fy, x, y]}
          stroke={SELECTED_STROKE}
          strokeWidth={1}
          listening={false}
        />
        <Circle
          name="handle-rotate"
          x={x}
          y={y}
          radius={HANDLE_RADIUS_PX + 1}
          fill={ROTATE_FILL}
          stroke={SELECTED_STROKE}
          strokeWidth={1.5}
          draggable
          onMouseEnter={(event) => setCursor(event, 'grab')}
          onMouseLeave={(event) => setCursor(event, 'default')}
          onPointerDown={(event) => {
            event.cancelBubble = true;
          }}
          onDragStart={(event) => beginGesture(event, object.id)}
          onDragMove={(event) => {
            const pointer = worldPointer(event);
            if (pointer === null) return;
            setGesture({ id: object.id, object: turned(pointer, event.evt.shiftKey) });
          }}
          onDragEnd={(event) => {
            const pointer = worldPointer(event);
            const next =
              pointer === null ? (gesture?.object ?? object) : turned(pointer, event.evt.shiftKey);
            commit(
              event.target,
              next,
              (result) => rotationHandlePoint(result, gap_m),
              rotationHandlePoint(object, gap_m),
            );
          }}
        />
      </Fragment>
    );
  };

  // A candidate carries a whole object, not a reference: the assistant may be
  // proposing something that is not in the document yet.
  const previewObject = preview?.object ?? null;

  // Two Konva layers: the objects, which change only with the document, the
  // viewport and a gesture; and the selection — outline and handles — which
  // changes on every click. Konva repaints a whole layer canvas when any node
  // in it changes, so keeping the selection apart means a click on a plan of
  // 1000 objects repaints one outline, not a thousand shapes (Q02, D-177).
  return (
    <>
      <Layer name="equipment">
        {plan.objects
          .filter((object) => visibleLayers.has(object.layerId))
          .map((object) => render(object, false))}

        {previewObject === null ? null : render(previewObject, true)}

        {/* Captions sit above every shape and never catch the pointer: the plan
            is read by a manager who should not have to click to learn what a
            rectangle is. Objects too small on screen stay uncaptioned. */}
        {plan.objects
          .filter((object) => visibleLayers.has(object.layerId))
          .map((object) => {
            const label = objectLabel(shown(object), viewport);
            if (label === null) return null;
            // Konva counts padding inside the box: without it the second line is cut.
            const height = label.lines * LABEL_LINE_PX + 2;
            return (
              <Label
                key={`label-${object.id}`}
                name={`label-${object.id}`}
                x={label.x - label.width / 2}
                y={label.y - height / 2}
                listening={false}
              >
                {/* A pale tag under the text: dark letters on a red rack are
                    unreadable. One legibility technique, applied everywhere
                    (D-216) — no outlined text alongside it. */}
                <Tag fill="#FFFFFF" opacity={0.85} cornerRadius={2} />
                <Text
                  width={label.width}
                  height={height}
                  text={label.text}
                  fontSize={label.fontSize}
                  lineHeight={LABEL_LINE_PX / label.fontSize}
                  fontFamily="system-ui, sans-serif"
                  fill="#212529"
                  align="center"
                  verticalAlign="middle"
                  // Always by word (D-216): a one-line caption too long for
                  // its box loses whole words to the ellipsis, never a
                  // half-word — «Стеллаж…», not «Стелл…».
                  wrap="word"
                  ellipsis
                  padding={1}
                />
              </Label>
            );
          })}

      </Layer>

      <Layer name="equipment-selection" ref={layerRef}>
        {(isGroup ? members : selectedObject === null || !selectedVisible ? [] : [selectedObject]).map(
          (object) => (
            <Line
              key={`outline-${object.id}`}
              name={`outline-${object.id}`}
              points={footprint(shown(object)).flatMap((point) => modelToScreen(point, viewport))}
              closed
              stroke={SELECTED_STROKE}
              strokeWidth={2}
              dash={[4, 3]}
              listening={false}
            />
          ),
        )}

        {/* A locked layer shows the selection but offers nothing to pull; a
            group has no handles — it moves, it is not resized or turned.
            Настенный прибор показывает только ручку поворота (D-228): тянуть
            размер камеры или датчика нечем — их габариты не планировочное
            решение, а характеристика изделия. */}
        {!picking || isGroup || selectedObject === null || !selectedVisible || lockedLayers.has(selectedObject.layerId)
          ? null
          : [
              ...(selectedFixedSize || !selectedHasRoomForResizeHandles
                ? []
                : RESIZE_HANDLES.map((handle) => renderResizeHandle(selectedObject, handle))),
              renderRotationHandle(selectedObject),
            ]}

        {/* What the move snapped to: a guide (a neighbour's edge, a wall's
            face) in one colour, a grid node in another. Drawn across the stage
            so the eye finds the partner even three metres away. */}
        {gesture?.lines === undefined
          ? null
          : (['x', 'y'] as const).map((axis) => {
              const snap = gesture.lines?.[axis];
              if (snap === null || snap === undefined) return null;
              const [sx, sy] = modelToScreen(axis === 'x' ? [snap.value, 0] : [0, snap.value], viewport);
              const { width, height } = gesture.lines ?? { width: 0, height: 0 };
              return (
                <Line
                  key={`snap-line-${axis}`}
                  name={`snap-line-${axis}-${snap.kind}`}
                  points={axis === 'x' ? [sx, 0, sx, height] : [0, sy, width, sy]}
                  stroke={snap.kind === 'guide' ? SNAP_GUIDE_STROKE : SNAP_GRID_STROKE}
                  strokeWidth={1}
                  dash={snap.kind === 'guide' ? undefined : [4, 4]}
                  listening={false}
                />
              );
            })}

        {marquee === null ? null : (
          <>
            <Rect
              name="marquee-overlay"
              x={0}
              y={0}
              width={marquee.width}
              height={marquee.height}
              fill="rgba(0,0,0,0)"
            />
            <Rect
              name="marquee"
              x={Math.min(marquee.from[0], marquee.to[0])}
              y={Math.min(marquee.from[1], marquee.to[1])}
              width={Math.abs(marquee.to[0] - marquee.from[0])}
              height={Math.abs(marquee.to[1] - marquee.from[1])}
              fill="rgba(51, 102, 204, 0.08)"
              stroke={SELECTED_STROKE}
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />
          </>
        )}

        <Label ref={setHoverLabel} name="equipment-hover" visible={false} listening={false}>
          <Tag
            fill="#212529"
            opacity={0.94}
            cornerRadius={6}
            pointerDirection="none"
            shadowColor="#000000"
            shadowBlur={8}
            shadowOpacity={0.24}
          />
          <Text
            ref={setHoverText}
            width={HOVER_WIDTH_PX}
            text=""
            fontSize={13}
            lineHeight={1.35}
            fontFamily="system-ui, sans-serif"
            fontStyle="normal"
            fill="#FFFFFF"
            padding={10}
            wrap="word"
          />
        </Label>
      </Layer>
    </>
  );
}
