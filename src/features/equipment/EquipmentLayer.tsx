/**
 * U04 (shapes and gestures): equipment on the plan.
 *
 * Size, symbol and colour come from the catalog, never from this file — that
 * is what makes a new equipment type appear on the plan after editing JSON.
 *
 * Move, rotate and resize are each one gesture and one command: the shape
 * follows the pointer locally and only the release dispatches `object.put`,
 * so undo returns the object to where it started rather than stepping back
 * through every frame. The arithmetic lives in transform.ts; this file only
 * converts the pointer to world metres and draws the result.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Equipment, Point } from '../../contracts/model';
import type { EquipmentLayerProps } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { footprint, modelToScreen, screenToModel } from '../../domain/geometry';
import {
  RESIZE_HANDLES,
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

/** Konva attribute set on the dragged node while Escape stops its drag. */
const CANCELLED_ATTR = 'gestureCancelled';

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
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const layerNode = useRef<Konva.Layer>(null);

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

  // Escape mid-gesture: Konva fires dragend from stopDrag, and the attribute
  // tells commit to put the shape back instead of dispatching a command.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const node = layerNode.current?.getStage()?.find((entry: Konva.Node) => entry.isDragging())[0];
      if (node === undefined) return;
      node.setAttr(CANCELLED_ATTR, true);
      node.stopDrag();
      node.setAttr(CANCELLED_ATTR, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  /** The pointer in world metres, through the one conversion in domain/geometry. */
  const worldPointer = (event: Konva.KonvaEventObject<DragEvent>): Point | null => {
    const position = event.target.getStage()?.getPointerPosition();
    if (position === undefined || position === null) return null;
    return screenToModel([position.x, position.y], viewport);
  };

  const setCursor = (event: Konva.KonvaEventObject<MouseEvent>, cursor: string): void => {
    const container = event.target.getStage()?.container();
    if (container !== undefined) container.style.cursor = cursor;
  };

  /** One put per finished gesture; a cancelled or refused one snaps the handle back. */
  const commit = (
    node: Konva.Node,
    next: Equipment,
    handleAfter: (object: Equipment) => Point,
    before: Point,
  ): void => {
    setGesture(null);
    const cancelled = node.getAttr(CANCELLED_ATTR) === true;
    const accepted = !cancelled && onCommand({ type: 'object.put', object: next }).ok;
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
        onPointerClick={() => onSelect({ kind: 'object', id: object.id })}
        onDragStart={() => onSelect({ kind: 'object', id: object.id })}
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
        }}
        onDragStart={() => onSelect({ kind: 'object', id: object.id })}
        onDragMove={(event) => {
          const pointer = worldPointer(event);
          if (pointer === null) return;
          setGesture({ id: object.id, object: { ...object, ...resizeFromPointer(object, handle, pointer) } });
        }}
        onDragEnd={(event) => {
          const pointer = worldPointer(event);
          const next =
            pointer === null
              ? (gesture?.object ?? object)
              : { ...object, ...resizeFromPointer(object, handle, pointer) };
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
          onDragStart={() => onSelect({ kind: 'object', id: object.id })}
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
    <Layer ref={layerNode}>
      {plan.objects
        .filter((object) => visibleLayers.has(object.layerId))
        .map((object) => render(object, false))}

      {previewObject === null ? null : render(previewObject, true)}

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
      {selectedObject === null || !selectedVisible || lockedLayers.has(selectedObject.layerId)
        ? null
        : [
            ...RESIZE_HANDLES.map((handle) => renderResizeHandle(selectedObject, handle)),
            renderRotationHandle(selectedObject),
          ]}
    </Layer>
  );
}
