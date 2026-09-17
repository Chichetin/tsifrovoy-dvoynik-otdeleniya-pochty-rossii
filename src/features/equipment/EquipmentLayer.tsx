/**
 * U04 (shapes and drag): equipment on the plan.
 *
 * Size, symbol and colour come from the catalog, never from this file — that
 * is what makes a new equipment type appear on the plan after editing JSON.
 *
 * A drag is one gesture and one command: the shape follows the pointer locally
 * and only the release dispatches `object.put`, so undo returns the object to
 * where it started rather than stepping back through every frame.
 */

import { useState } from 'react';
import { Circle, Layer, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Equipment, Point } from '../../contracts/model';
import type { EquipmentLayerProps } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { footprint, modelToScreen, screenToModel } from '../../domain/geometry';

const FALLBACK_COLOR = '#868E96';
const SELECTED_STROKE = '#1971C2';

export function EquipmentLayer({
  document: plan,
  session,
  onCommand,
  onSelect,
  preview,
}: EquipmentLayerProps): React.JSX.Element {
  const { viewport, selection } = session;
  const [dragging, setDragging] = useState<{ id: string; position: Point } | null>(null);

  const visibleLayers = new Set(
    plan.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );
  const lockedLayers = new Set(
    plan.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );

  const render = (object: Equipment, ghost: boolean): React.JSX.Element | null => {
    const type = findObjectType(plan.catalog, object.typeId);
    const colour = type?.color ?? FALLBACK_COLOR;
    const position =
      dragging !== null && dragging.id === object.id ? dragging.position : object.position;
    const [x, y] = modelToScreen(position, viewport);
    const width = object.size_m[0] * viewport.scale;
    const height = object.size_m[1] * viewport.scale;
    const selected = selection?.kind === 'object' && selection.id === object.id;
    const draggable = !ghost && !lockedLayers.has(object.layerId);

    const common = {
      // Konva rotates clockwise on a Y-down canvas, which matches the model's
      // clockwise convention without a sign flip here.
      rotation: object.rotation_deg,
      fill: colour,
      opacity: ghost ? 0.45 : 0.9,
      stroke: selected ? SELECTED_STROKE : '#343A40',
      strokeWidth: selected ? 2.5 : 1,
      draggable,
      listening: !ghost,
      onPointerClick: () => onSelect({ kind: 'object', id: object.id }),
      onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => {
        const node = event.target;
        setDragging({
          id: object.id,
          position: screenToModel([node.x(), node.y()], viewport),
        });
      },
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
        const node = event.target;
        const moved = screenToModel([node.x(), node.y()], viewport);
        setDragging(null);
        const result = onCommand({ type: 'object.put', object: { ...object, position: moved } });
        // A refused move must not leave the shape where the pointer dropped it.
        if (!result.ok) node.position({ x, y });
      },
    };

    if (type?.symbol === 'circle') {
      return (
        <Circle key={object.id} x={x} y={y} radius={Math.max(width, height) / 2} {...common} />
      );
    }
    if (type?.symbol === 'triangle') {
      return (
        <Line
          key={object.id}
          x={x}
          y={y}
          points={[0, -height / 2, width / 2, height / 2, -width / 2, height / 2]}
          closed
          {...common}
        />
      );
    }
    return (
      <Rect
        key={object.id}
        x={x}
        y={y}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
        {...common}
      />
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

      {plan.objects
        .filter((object) => visibleLayers.has(object.layerId))
        .filter((object) => selection?.kind === 'object' && selection.id === object.id)
        .map((object) => (
          <Line
            key={`outline-${object.id}`}
            points={footprint(object).flatMap((point) => modelToScreen(point, viewport))}
            closed
            stroke={SELECTED_STROKE}
            strokeWidth={1}
            dash={[4, 3]}
            listening={false}
          />
        ))}
    </Layer>
  );
}
