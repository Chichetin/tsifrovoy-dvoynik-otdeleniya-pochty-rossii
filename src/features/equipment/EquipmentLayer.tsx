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
import { Circle, Group, Layer, Line, Path, Rect, Text } from 'react-konva';
import Konva from 'konva';
import type { Equipment, Id, Point, Polygon } from '../../contracts/model';
import type { EquipmentLayerProps } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { takenIds } from '../../domain/commands';
import { activeObjectColor, objectColorValue } from '../../domain/object-color';
import {
  SNAP,
  dragObstacles,
  guideObjects,
  footprint,
  modelToScreen,
  objectGaps,
  objectGuides,
  objectOutline,
  screenToModel,
  snapObjectCentre,
} from '../../domain/geometry';
import type { AxisSnap, Gap } from '../../domain/geometry';
import { formatLength } from '../../domain/number-format';
import { createGestureGuard } from './gesture-guard';
import { equipmentHoverHint, equipmentHoverSummary } from './hover-summary';
import { fitCaption } from './caption-fit';
import { CAPTION_ICON_SPACE_PX, LABEL_LINE_PX, objectLabel } from './object-label';
import {
  arrowDelta,
  duplicateObjects,
  marqueeHits,
  moveObjects,
  pasteObjects,
  repeatOffset,
  rotateDelta,
  rotateObjects,
} from './selection-edit';
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
import {
  isPlanPictogramVisible,
  planPictogram,
  planPictogramNeedsBackdrop,
  planPictogramSize,
  PLAN_PICTOGRAM_PATHS,
  type PlanPictogram,
} from '../../domain/plan-pictogram';

const FALLBACK_COLOR = '#868E96';
const SELECTED_STROKE = '#1971C2';
/** Snap lines (operator 20.09 №3): a guide is the plan's own edge, the grid is a hint. */
const SNAP_GUIDE_STROKE = '#E64980';
const SNAP_GRID_STROKE = '#868E96';
/** Distance from the moved object to the nearest wall and neighbour (#20). */
const GAP_STROKE = '#495057';
const GAP_LABEL_WIDTH_PX = 128;
const GAP_LABEL_HEIGHT_PX = 18;
const HANDLE_FILL = '#FFFFFF';
const ROTATE_FILL = '#E7F5FF';

/** Handles keep a screen size: a 10 cm object is still grabbable at any zoom. */
const HANDLE_RADIUS_PX = 6;
const ROTATION_GAP_PX = 28;
const HOVER_WIDTH_PX = 320;
const HOVER_GAP_PX = 14;
/** Раскладка карточки наведения: отступ от края и просветы между блоками. */
const HOVER_PAD_PX = 12;
const HOVER_TEXT_WIDTH_PX = HOVER_WIDTH_PX - HOVER_PAD_PX * 2;
const HOVER_RULE_GAP_PX = 9;

/**
 * What a move snapped to, for the eye (D-215): the world line the object's
 * edge landed on, per axis, and the stage size to draw it across.
 */
type SnapLines = { x: AxisSnap | null; y: AxisSnap | null; width: number; height: number };

/** Shortest lines from the moved object to the nearest wall and neighbour, in world metres. */
type Gaps = { wall: Gap | null; object: Gap | null };

/**
 * The object as the pointer is currently shaping it; null outside a gesture.
 * `delta` is set while a member of a group is dragged: the other members
 * follow by the same offset in model metres, from their own positions.
 * `lines` — what the move snapped to, `gaps` — how far the object is from the
 * nearest wall and neighbour; both are drawn on the selection layer.
 */
type Gesture = { id: string; object: Equipment; delta?: Point; lines?: SnapLines; gaps?: Gaps };

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

function midpoint(from: Point, to: Point): Point {
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

type EquipmentSymbolProps = {
  /** Outline in fractions of the size, model frame (Y up), see contracts/outline.ts. */
  outline: Polygon;
  width: number;
  height: number;
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
};

/**
 * The object's outline (D-277) as a Konva shape centred on its group's origin;
 * no behaviour. The shape comes from the document — the loader has already
 * given every object its type's outline — so a round table, a triangle camera
 * and an L-shaped desk are one closed line, the same ring the checks use.
 * Memoised on its props: react-konva repaints a whole layer as soon as
 * one node gets a "new" prop; the outline array belongs to the document and
 * keeps its identity, and the points are rebuilt only when it or the size changes.
 * With the memo a click elsewhere leaves a thousand shapes untouched.
 * `perfectDrawEnabled: false` (D-187): a translucent shape with fill and stroke
 * is otherwise painted through a stage-sized buffer canvas — one clear and one
 * full-canvas copy per object on every redraw of the layer (zoom, pan, drag,
 * open). Budgets: `tests/perf/editor.spec.ts`.
 */
const EquipmentSymbol = memo(function EquipmentSymbol({
  outline,
  width,
  height,
  ...style
}: EquipmentSymbolProps): React.JSX.Element {
  // Model Y is up, the group's local Y is down: the one flip, at the vertex.
  const points = useMemo(
    () => outline.flatMap(([u, v]) => [u * width, -v * height]),
    [outline, width, height],
  );
  return <Line points={points} closed perfectDrawEnabled={false} {...style} />;
});

/**
 * Thin white line icons make a completed plan readable without turning it
 * into an admin table. They sit inside the object and never receive input;
 * moving, selecting and checking the object still belongs to its footprint.
 */
function EquipmentPictogram({
  kind,
  width,
  height,
  opacity,
  color = '#FFFFFF',
  backdrop,
}: {
  kind: PlanPictogram;
  width: number;
  height: number;
  opacity: number;
  color?: string;
  /** Цвет объекта: подложка под знак, который крупнее самого объекта. */
  backdrop?: string;
}): React.JSX.Element | null {
  if (kind === null || !isPlanPictogramVisible(width, height)) return null;
  const size = planPictogramSize(width, height);
  const scale = size / 24;
  const icon = (
    <Path
      name={`plan-pictogram-${kind}`}
      data={PLAN_PICTOGRAM_PATHS[kind]}
      x={-size / 2}
      y={-size / 2}
      scaleX={scale}
      scaleY={scale}
      stroke={color}
      strokeWidth={2.3}
      lineCap="round"
      lineJoin="round"
      opacity={opacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
  // Розетка, камера и датчик мельче собственного знака: без подложки его белые
  // линии выходят за объект на светлый пол и пропадают.
  if (backdrop === undefined || !planPictogramNeedsBackdrop(width, height)) return icon;
  return (
    <>
      <Circle
        name="plan-pictogram-backdrop"
        radius={size * 0.62}
        fill={backdrop}
        opacity={opacity}
        stroke="#343A40"
        strokeWidth={0.5}
        listening={false}
        perfectDrawEnabled={false}
      />
      {icon}
    </>
  );
}
export function EquipmentLayer({
  document: plan,
  session,
  onCommand,
  onSelect,
  onSelectMany,
  preview,
  onGesturePreview,
  hideHandlesFor = null,
  pictograms = true,
  captions = true,
}: EquipmentLayerProps & {
  /** The object whose shape is being edited (D-290): its resize and rotation handles step aside. */
  hideHandlesFor?: Id | null;
  /**
   * Показывать условные значки типов. Состояние вида, не документа: выключение
   * оставляет цвет, форму и подписи — так план читают те, кому привычнее
   * чистые фигуры (переключатель в панели слоёв).
   */
  pictograms?: boolean;
  /** Names on the plan; off by default in the app (D-362), the hover summary still names an object. */
  captions?: boolean;
}): React.JSX.Element {
  const { viewport, selection } = session;
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
  const colorLayer = useMemo(() => activeObjectColor(plan), [plan]);
  const lockedLayers = new Set(
    plan.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );

  const selectedObject =
    selection?.kind === 'object'
      ? (plan.objects.find((object) => object.id === selection.id) ?? null)
      : null;
  const selectedVisible = selectedObject !== null && visibleLayers.has(selectedObject.layerId);
  const selectedLocked = selectedObject !== null && (selectedObject.locked === true || lockedLayers.has(selectedObject.layerId));
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
  // Последний Ctrl+D: id копии → где стоял её оригинал. Копию сдвинули — повторный
  // Ctrl+D ставит следующую от неё с тем же смещением (ряд стульев).
  const duplicated = useRef<Map<Id, Point>>(new Map());

  // The group (marquee, Shift+click): visible members only, the primary among
  // them. One member is the ordinary single selection; two or more make the
  // keys, the drag and Delete act on all of them, as one command each.
  const group = session.selected ?? NO_GROUP;
  const members = plan.objects.filter(
    (object) => group.has(object.id) && visibleLayers.has(object.layerId),
  );
  const isGroup = members.length > 1;
  // A locked layer neither drags nor moves by key; its members stay put.
  const movable = members.filter((object) => object.locked !== true && !lockedLayers.has(object.layerId));
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const press = useRef<{ from: Point; shift: boolean } | null>(null);
  const layerRef = useRef<Konva.Layer>(null);
  // Konva nodes live in state so event callbacks can update them without a
  // React render on every pointer move. They are assigned once on mount.
  const [hoverCard, setHoverCard] = useState<Konva.Group | null>(null);
  const [hoverBox, setHoverBox] = useState<Konva.Rect | null>(null);
  const [hoverTitle, setHoverTitle] = useState<Konva.Text | null>(null);
  const [hoverRule, setHoverRule] = useState<Konva.Line | null>(null);
  const [hoverHint, setHoverHint] = useState<Konva.Text | null>(null);
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
  // мелкий, Ctrl+C/Ctrl+V копируют и вставляют со смещением, Ctrl+D дублирует
  // без буфера, R/Shift+R поворачивают на фиксированный шаг. Одно нажатие —
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

      // Ctrl+D — «второй такой же предмет прямо сейчас», не второе имя для
      // Ctrl+C/Ctrl+V: свой снимок каждый раз, без общего буфера и без его
      // счётчика вставок подряд. `preventDefault` — раньше проверки выделения:
      // иначе Ctrl+D без выделенного или со скрытым объектом уходит браузеру и
      // открывает закладки вместо того, чтобы молча ничего не делать.
      if (combo && event.code === 'KeyD') {
        event.preventDefault();
        if (selectedObject === null || !selectedVisible) return;
        const taken = takenIds(plan, session.retired);
        const sources = isGroup ? members : [selectedObject];
        const from = duplicated.current.get(selectedObject.id);
        const copies = duplicateObjects(
          sources,
          taken,
          from === undefined ? undefined : repeatOffset(from, selectedObject.position),
        );
        if (copies.length === 0 || !onCommand({ type: 'batch', commands: copies.map(put) }).ok) return;
        duplicated.current = new Map(copies.map((copy, i) => [copy.id, sources[i]!.position]));
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

      // R поворачивает по часовой на фиксированный шаг, Shift+R — против; как
      // ручка поворота на холсте, только у одиночного видимого объекта на
      // разблокированном слое — у группы своей ручки поворота тоже нет.
      const rotation = rotateDelta(event.code, event.shiftKey);
      if (rotation !== null) {
        if (!isGroup && !selectedLocked) {
          event.preventDefault();
          const [rotated] = rotateObjects([selectedObject], rotation);
          if (rotated !== undefined) onCommand(put(rotated));
        }
        return;
      }

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
    const card = hoverCard;
    if (card === null || !card.visible()) return;
    card.hide();
    card.getLayer()?.batchDraw();
  };

  /** Imperative on purpose: hovering must not reconcile a thousand object nodes. */
  const showHover = (event: Konva.KonvaEventObject<MouseEvent>, object: Equipment): void => {
    if (Konva.isDragging()) {
      hideHover();
      return;
    }
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    const card = hoverCard;
    const box = hoverBox;
    const title = hoverTitle;
    const rule = hoverRule;
    const hint = hoverHint;
    if (stage === null || stage === undefined || pointer === null || pointer === undefined) return;
    if (card === null || box === null || title === null || rule === null || hint === null) return;

    const summary = equipmentHoverSummary(shown(object), picking);
    title.text(summary.title);
    hint.text(summary.hint);

    // Высоту карточки знает только Konva — она зависит от переносов строк,
    // поэтому блоки укладываются после того, как текст уже задан.
    let y = HOVER_PAD_PX;
    title.y(y);
    y += title.height() + HOVER_RULE_GAP_PX;
    rule.points([HOVER_PAD_PX, y, HOVER_WIDTH_PX - HOVER_PAD_PX, y]);
    y += HOVER_RULE_GAP_PX;
    hint.y(y);
    const height = y + hint.height() + HOVER_PAD_PX;
    box.height(height);

    const left = Math.min(pointer.x + HOVER_GAP_PX, Math.max(0, stage.width() - HOVER_WIDTH_PX));
    const below = pointer.y + HOVER_GAP_PX;
    const top = below + height <= stage.height()
      ? below
      : Math.max(0, pointer.y - height - HOVER_GAP_PX);
    card.position({ x: left, y: top });
    card.show();
    card.moveToTop();
    card.getLayer()?.batchDraw();
  };

  // A keyboard tool switch can leave the pointer still over the same object.
  // Refresh only the hint node, keeping the document and equipment nodes intact.
  useEffect(() => {
    if (hoverHint === null || hoverBox === null || hoverCard === null || !hoverCard.visible()) return;
    hoverHint.text(equipmentHoverHint(picking));
    const height = hoverHint.y() + hoverHint.height() + HOVER_PAD_PX;
    hoverBox.height(height);
    const stage = hoverCard.getStage();
    if (stage !== null) hoverCard.y(Math.min(hoverCard.y(), Math.max(0, stage.height() - height)));
    hoverCard.getLayer()?.batchDraw();
  }, [picking, hoverHint, hoverBox, hoverCard]);

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
    const neighbours = guideObjects(plan, moving);
    guard.begin({
      node,
      origin: { x: node.x(), y: node.y() },
      grab,
      guides: objectGuides(plan, moving, neighbours),
      obstacles: dragObstacles(plan, moving, neighbours),
    });
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
    if (gesture.delta === undefined || !group.has(object.id) || object.locked === true || lockedLayers.has(object.layerId)) {
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
    const hasCaption = captions && objectLabel(current, viewport,
      pictograms && planPictogram(object.typeId) !== null ? CAPTION_ICON_SPACE_PX : 0) !== null;
    const [x, y] = modelToScreen(current.position, viewport);
    // Alt during the drag turns snapping off (D-208). The drop reuses what the
    // last move saw: a key released a moment before the button must not make
    // the object jump at release.
    const movedTo = (
      node: Konva.Node,
      evt: unknown,
      phase: 'move' | 'drop',
    ): { position: Point; lines?: SnapLines; gaps?: Gaps } => {
      const centre = screenToModel([node.x(), node.y()], viewport);
      const started = guard.started;
      if (phase === 'move' && started !== null) {
        started.snapOff = typeof evt === 'object' && evt !== null && 'altKey' in evt && evt.altKey === true;
      }
      // The drop needs only the position: the distances leave with the gesture.
      const obstacles = phase === 'move' ? started?.obstacles : undefined;
      const measured = (position: Point): Gaps | undefined =>
        obstacles === undefined ? undefined : objectGaps({ ...object, position }, obstacles);
      const guides = started?.guides;
      if (started?.snapOff === true || guides === undefined) {
        const position = snapPosition(centre);
        return { position, gaps: measured(position) };
      }
      // Already settled by the domain: a guide axis keeps the guide's own
      // millimetres, rounding it to the centimetre would push it into the wall.
      const snapped = snapObjectCentre(object, centre, guides, SNAP.grid_m, SNAP.tolerance_px / viewport.scale);
      const stage = node.getStage();
      const lines: SnapLines | undefined =
        stage === null || (snapped.snap.x === null && snapped.snap.y === null)
          ? undefined
          : { x: snapped.snap.x, y: snapped.snap.y, width: stage.width(), height: stage.height() };
      return { position: snapped.centre, lines, gaps: measured(snapped.centre) };
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
        // The ruler only reads the plan: a press-and-drag there must not move
        // the object under it (D-256).
        draggable={!ghost && session.tool.kind !== 'measure' && object.locked !== true && !lockedLayers.has(object.layerId)}
        listening={!ghost}
        onPointerClick={
          picking
            ? (event) => {
                // The right button opens the object's menu and keeps the group (#24).
                if (event.evt.button !== 0) return;
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
          setCursor(event, object.locked === true || lockedLayers.has(object.layerId) ? 'default' : 'grab');
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
          setGesture({
            id: object.id,
            object: next,
            delta: groupDelta(object, next),
            lines: moved.lines,
            gaps: moved.gaps,
          });
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
          outline={objectOutline(current)}
          width={current.size_m[0] * viewport.scale}
          height={current.size_m[1] * viewport.scale}
          fill={colorLayer === null ? (type?.color ?? FALLBACK_COLOR) : objectColorValue(colorLayer, current.attributes).color}
          opacity={ghost ? 0.45 : 0.9}
          // Selection is drawn on its own layer below: a shape that depends on
          // `selection` would make every click repaint all thousand of them.
          stroke="#343A40"
          strokeWidth={1}
        />
        {object.locked !== true || ghost ? null : (
          <Group name={`object-lock-${object.id}`} x={current.size_m[0] * viewport.scale / 2}
            y={-current.size_m[1] * viewport.scale / 2} rotation={-current.rotation_deg} listening={false}>
            <Circle radius={9} fill="#FFFFFF" stroke="#343A40" strokeWidth={1} />
            <Rect x={-3} y={-5} width={6} height={7} cornerRadius={3} stroke="#343A40" strokeWidth={1.5} />
            <Rect x={-4} y={-1} width={8} height={6} cornerRadius={1} fill="#343A40" />
            <Circle x={0} y={2} radius={1} fill="#FFFFFF" />
          </Group>
        )}
        {hasCaption ? null : (
          <EquipmentPictogram
            kind={pictograms ? planPictogram(object.typeId) : null}
            width={current.size_m[0] * viewport.scale}
            height={current.size_m[1] * viewport.scale}
            opacity={ghost ? 0.45 : 0.9}
            backdrop={colorLayer === null ? (type?.color ?? FALLBACK_COLOR) : objectColorValue(colorLayer, current.attributes).color}
          />
        )}
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
          .filter((object) => captions && visibleLayers.has(object.layerId))
          .map((object) => {
            const kind = pictograms ? planPictogram(object.typeId) : null;
            const iconSpace = kind === null ? 0 : CAPTION_ICON_SPACE_PX;
            const label = objectLabel(shown(object), viewport, iconSpace);
            if (label === null) return null;
            // The symbol and the name share one badge. A separate floating
            // marker used to cover the caption on the busy demo plan.
            const fit = fitCaption(label.text, label.fontSize, iconSpace, label.width, label.lines);
            const height = Math.max(fit.lines * LABEL_LINE_PX + 4, iconSpace === 0 ? 0 : 22);
            return (
              <Group
                key={`label-${object.id}`}
                name={`label-${object.id}`}
                // Поворот — вокруг центра объекта, поэтому точка задаётся
                // центром, а смещение уводит бирку в её левый верхний угол.
                // Так неповёрнутая подпись стоит ровно там же, где стояла.
                x={label.x}
                y={label.y}
                offsetX={fit.width / 2}
                offsetY={height / 2}
                rotation={label.rotation}
                listening={false}
              >
                {/* D-363: a dark glass tag, the icon on the type's own colour. */}
                <Rect
                  width={fit.width}
                  height={height}
                  fill="#17232E"
                  opacity={0.88}
                  stroke="#FFFFFF"
                  strokeWidth={0.75}
                  cornerRadius={Math.min(6, height / 2)}
                  listening={false}
                  perfectDrawEnabled={false}
                />
                {kind === null ? null : (
                  <Group name={`plan-pictogram-caption-${object.id}`} x={11} y={height / 2} listening={false}>
                    <Rect
                      x={-9}
                      y={-9}
                      width={18}
                      height={18}
                      fill={findObjectType(plan.catalog, object.typeId)?.color ?? FALLBACK_COLOR}
                      cornerRadius={5}
                      listening={false}
                    />
                    <EquipmentPictogram
                      kind={kind}
                      width={20}
                      height={20}
                      opacity={1}
                      color="#FFFFFF"
                    />
                  </Group>
                )}
                <Text
                  x={iconSpace}
                  width={fit.width - iconSpace}
                  height={height}
                  text={label.text}
                  fontSize={label.fontSize}
                  lineHeight={LABEL_LINE_PX / label.fontSize}
                  fontFamily="system-ui, sans-serif"
                  fill="#FFFFFF"
                  align="center"
                  verticalAlign="middle"
                  // Always by word (D-216): a one-line caption too long for
                  // its box loses whole words to the ellipsis, never a
                  // half-word — «Стеллаж…», not «Стелл…».
                  wrap="word"
                  ellipsis
                  padding={1}
                />
              </Group>
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
        {/* D-290: in shape mode the object's vertices are the handles; resize
            and rotation would overlap them and catch their presses. */}
        {!picking ||
        isGroup ||
        selectedObject === null ||
        !selectedVisible ||
        selectedLocked ||
        selectedObject.id === hideHandlesFor
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
                  dash={snap.kind === 'guide' ? [6, 4] : [2, 4]}
                  listening={false}
                />
              );
            })}

        {/* How far the moved object is from the nearest wall and neighbour: a
            dashed line along the shortest gap and its length in metres. */}
        {gesture?.gaps === undefined
          ? null
          : (['wall', 'object'] as const).map((kind) => {
              const gap = gesture.gaps?.[kind];
              if (gap === null || gap === undefined) return null;
              const [x1, y1] = modelToScreen(gap.from, viewport);
              const [x2, y2] = modelToScreen(gap.to, viewport);
              // Two short gaps put both labels on the same spot: the second one
              // steps down by its own height so both numbers stay readable.
              const wall = gesture.gaps?.wall ?? null;
              const [wx, wy] = wall === null ? [Infinity, Infinity] : modelToScreen(midpoint(wall.from, wall.to), viewport);
              const crowded =
                kind === 'object' &&
                Math.abs(wx - (x1 + x2) / 2) < GAP_LABEL_WIDTH_PX &&
                Math.abs(wy - (y1 + y2) / 2) < GAP_LABEL_HEIGHT_PX + 2;
              return (
                <Fragment key={`gap-${kind}`}>
                  <Line
                    name={`gap-line-${kind}`}
                    points={[x1, y1, x2, y2]}
                    stroke={GAP_STROKE}
                    strokeWidth={1}
                    dash={[3, 3]}
                    listening={false}
                  />
                  <Group
                    name={`gap-label-${kind}`}
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 + (crowded ? GAP_LABEL_HEIGHT_PX + 2 : 0)}
                    offsetX={GAP_LABEL_WIDTH_PX / 2}
                    offsetY={GAP_LABEL_HEIGHT_PX / 2}
                    listening={false}
                  >
                    <Rect
                      width={GAP_LABEL_WIDTH_PX}
                      height={GAP_LABEL_HEIGHT_PX}
                      fill="#FFFFFF"
                      opacity={0.94}
                      stroke={GAP_STROKE}
                      strokeWidth={1}
                      cornerRadius={3}
                    />
                    <Text
                      width={GAP_LABEL_WIDTH_PX}
                      height={GAP_LABEL_HEIGHT_PX}
                      text={`${kind === 'wall' ? 'до стены' : 'до объекта'} ${formatLength(gap.distance)}`}
                      fontSize={12}
                      fontFamily="system-ui, sans-serif"
                      fill="#212529"
                      align="center"
                      verticalAlign="middle"
                    />
                  </Group>
                </Fragment>
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

        {/*
          Карточка наведения собрана из отдельных узлов, а не из одного Text в
          Label: имя, тип, факты и подсказка набраны разным кеглем и цветом, а
          один Text даёт только один стиль на всю карточку.
        */}
        <Group ref={setHoverCard} name="equipment-hover" visible={false} listening={false}>
          <Rect
            ref={setHoverBox}
            width={HOVER_WIDTH_PX}
            height={0}
            fill="#1A1D21"
            opacity={0.97}
            cornerRadius={10}
            stroke="#3A4149"
            strokeWidth={1}
            shadowColor="#000000"
            shadowBlur={16}
            shadowOffsetY={4}
            shadowOpacity={0.32}
          />
          <Text
            ref={setHoverTitle}
            x={HOVER_PAD_PX}
            width={HOVER_TEXT_WIDTH_PX}
            text=""
            fontSize={18}
            lineHeight={1.25}
            fontFamily="system-ui, sans-serif"
            fontStyle="600"
            fill="#FFFFFF"
            wrap="word"
          />
          <Line ref={setHoverRule} points={[]} stroke="#333A42" strokeWidth={1} />
          <Text
            ref={setHoverHint}
            x={HOVER_PAD_PX}
            width={HOVER_TEXT_WIDTH_PX}
            text=""
            fontSize={14}
            lineHeight={1.3}
            fontFamily="system-ui, sans-serif"
            fill="#74C0FC"
            wrap="word"
          />
        </Group>
      </Layer>
    </>
  );
}
