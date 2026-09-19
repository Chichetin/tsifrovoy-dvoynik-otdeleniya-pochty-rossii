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

import { Fragment, useEffect, useRef, useState } from 'react';
import { Circle, Group, Label, Layer, Line, Rect, Tag, Text } from 'react-konva';
import type Konva from 'konva';
import type { Equipment, Id, Point } from '../../contracts/model';
import type { EquipmentLayerProps } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { footprint, modelToScreen, screenToModel } from '../../domain/geometry';
import { createGestureGuard } from './gesture-guard';
import { LABEL_LINE_PX, objectLabel } from './object-label';
import { arrowDelta, moveObjects, pasteObjects } from './selection-edit';
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

const FALLBACK_COLOR = '#868E96';
const SELECTED_STROKE = '#1971C2';
const HANDLE_FILL = '#FFFFFF';
const ROTATE_FILL = '#E7F5FF';

/** Handles keep a screen size: a 10 cm object is still grabbable at any zoom. */
const HANDLE_RADIUS_PX = 6;
const ROTATION_GAP_PX = 28;

/** The object as the pointer is currently shaping it; null outside a gesture. */
type Gesture = { id: string; object: Equipment };

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

/** The catalog symbol as a Konva shape centred on its group's origin; no behaviour. */
function EquipmentSymbol({ symbol, width, height, ...paint }: EquipmentSymbolProps): React.JSX.Element {
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
}

export function EquipmentLayer({
  document: plan,
  session,
  onCommand,
  onSelect,
  preview,
}: EquipmentLayerProps): React.JSX.Element {
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
  const lockedLayers = new Set(
    plan.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );

  const selectedObject =
    selection?.kind === 'object'
      ? (plan.objects.find((object) => object.id === selection.id) ?? null)
      : null;
  const selectedVisible = selectedObject !== null && visibleLayers.has(selectedObject.layerId);
  const selectedLocked = selectedObject !== null && lockedLayers.has(selectedObject.layerId);
  const clipboard = useRef<Clipboard | null>(null);

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
      cancelled.node.position(cancelled.origin);
      cancelled.node.stopDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guard]);

  // Delete removes what the user sees selected; a hidden object is out of reach,
  // and a key pressed inside a field belongs to that field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (isTypingTarget(event.target)) return;
      if (selectedObject === null || !selectedVisible) return;
      event.preventDefault();
      onCommand({ type: 'object.delete', id: selectedObject.id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCommand, selectedObject, selectedVisible]);

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
      if (selectedObject === null || !selectedVisible) return;

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const delta = arrowDelta(event.key, event.shiftKey);
        // Заблокированный слой не тянется мышью — не двигается и стрелками.
        if (delta === null || selectedLocked) return;
        event.preventDefault();
        const [moved] = moveObjects([selectedObject], delta);
        if (moved !== undefined) onCommand({ type: 'object.put', object: moved });
        return;
      }

      if (!event.ctrlKey && !event.metaKey) return;

      if (event.code === 'KeyC') {
        event.preventDefault();
        clipboard.current = { objects: [selectedObject], pastes: 0 };
        return;
      }

      if (event.code === 'KeyV') {
        const buffer = clipboard.current;
        if (buffer === null) return;
        event.preventDefault();
        // Свободные номера считаются и по плану, и по удалённым в этой сессии
        // id (D-156): иначе первая же вставка после удаления ляжет на
        // retired-id и команда откажет ID_REUSED.
        const taken = new Set<Id>([
          ...plan.objects.map((object) => object.id),
          ...(session.retired ?? []),
        ]);
        const copies = pasteObjects(buffer.objects, taken, buffer.pastes + 1);
        let pasted = 0;
        for (const copy of copies) {
          if (onCommand({ type: 'object.put', object: copy }).ok) pasted += 1;
        }
        if (pasted === 0) return;
        buffer.pastes += 1;
        // Вставленное сразу выбрано: карточка показывает копию, и следующая
        // стрелка двигает именно её (D-147).
        const last = copies.at(-1);
        if (last !== undefined) onSelect({ kind: 'object', id: last.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    onCommand,
    onSelect,
    plan.objects,
    selectedLocked,
    selectedObject,
    selectedVisible,
    session.retired,
  ]);

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

  /** Start of every gesture: select what is being pulled, remember where from. */
  const beginGesture = (
    event: Konva.KonvaEventObject<unknown>,
    id: string,
    grab: Point = [0, 0],
  ): void => {
    const node = event.target;
    guard.begin({ node, origin: { x: node.x(), y: node.y() }, grab });
    onSelect({ kind: 'object', id });
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
    const accepted = guard.finish() && onCommand({ type: 'object.put', object: next }).ok;
    const [x, y] = modelToScreen(accepted ? handleAfter(next) : before, viewport);
    node.position({ x, y });
  };

  const shown = (object: Equipment): Equipment =>
    gesture !== null && gesture.id === object.id ? gesture.object : object;

  const render = (object: Equipment, ghost: boolean): React.JSX.Element => {
    const type = findObjectType(plan.catalog, object.typeId);
    const current = shown(object);
    const [x, y] = modelToScreen(current.position, viewport);
    const selected = selection?.kind === 'object' && selection.id === object.id;
    const movedTo = (node: Konva.Node): Point =>
      snapPosition(screenToModel([node.x(), node.y()], viewport));

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
        onPointerClick={picking ? () => onSelect({ kind: 'object', id: object.id }) : undefined}
        onDragStart={(event) => beginGesture(event, object.id)}
        onDragMove={(event) => {
          setGesture({ id: object.id, object: { ...object, position: movedTo(event.target) } });
        }}
        onDragEnd={(event) => {
          // A refused move must not leave the shape where the pointer dropped it.
          commit(
            event.target,
            { ...object, position: movedTo(event.target) },
            (next) => next.position,
            object.position,
          );
        }}
      >
        <EquipmentSymbol
          symbol={type?.symbol}
          width={current.size_m[0] * viewport.scale}
          height={current.size_m[1] * viewport.scale}
          fill={type?.color ?? FALLBACK_COLOR}
          opacity={ghost ? 0.45 : 0.9}
          stroke={selected ? SELECTED_STROKE : '#343A40'}
          strokeWidth={selected ? 2.5 : 1}
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

  return (
    <Layer>
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
              {/* A pale tag under the text: dark letters on a red rack are unreadable. */}
              <Tag fill="#FFFFFF" opacity={0.72} cornerRadius={2} />
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
                wrap={label.lines === 2 ? 'word' : 'none'}
                ellipsis
                padding={1}
              />
            </Label>
          );
        })}

      {selectedObject === null || !selectedVisible ? null : (
        <Line
          key={`outline-${selectedObject.id}`}
          points={footprint(shown(selectedObject)).flatMap((point) =>
            modelToScreen(point, viewport),
          )}
          closed
          stroke={SELECTED_STROKE}
          strokeWidth={1}
          dash={[4, 3]}
          listening={false}
        />
      )}

      {/* A locked layer shows the selection but offers nothing to pull. */}
      {!picking || selectedObject === null || !selectedVisible || lockedLayers.has(selectedObject.layerId)
        ? null
        : [
            ...RESIZE_HANDLES.map((handle) => renderResizeHandle(selectedObject, handle)),
            renderRotationHandle(selectedObject),
          ]}
    </Layer>
  );
}
