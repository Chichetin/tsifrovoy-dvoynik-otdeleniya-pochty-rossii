/**
 * Object shape editing on the plan (D-279).
 *
 * #105: only for the object whose «Изменить форму» switch is on (the switch
 * is in the properties card). A double click on that object under «Выбор» puts it into shape mode: its
 * world footprint grows vertex handles, the same gestures as a zone's ring —
 * drag a vertex, click the middle of an edge to add one, double click (or
 * Ctrl + click) a vertex to remove it. Each finished gesture is one
 * `object.put`, folded back into `size_m`/`position`/`outline` by
 * `reshapeObject`, so undo returns the whole gesture. Enter, Escape, another
 * selection or another tool leave the mode.
 *
 * The layer is mounted above the equipment layer: its handles must win over
 * the object's own drag and resize handles while the mode is on. Outside the
 * mode it draws nothing and listens to nothing but the stage's double click.
 */

import { useEffect, useState } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import type { Equipment, Id, PlanDocument, Point, Polygon } from '../../contracts/model';
import type { CommandSink, EditorSession } from '../../contracts/ui';
import {
  SNAP,
  footprint,
  modelToScreen,
  pointGuides,
  screenToModel,
  settlePoint,
  snapPoint,
} from '../../domain/geometry';
import {
  MIN_VERTICES_NOTICE,
  NEAR_VERTEX_NOTICE,
  SELF_INTERSECTION_NOTICE,
  SHAPE_EDIT_NOTICE,
  SHAPE_TOO_SMALL_NOTICE,
  getNotice,
  setNotice,
} from './notice';
import { reshapeObject } from './object-shape';
import { isTextTarget } from './text-target';
import {
  HANDLE_RADIUS_PX,
  canCommitRing,
  insertVertex,
  insertionOnEdge,
  moveVertex,
  removeVertex,
  roundPoint,
} from './vertex-edit';

const SHAPE_STROKE = '#1971C2';
const INVALID_STROKE = '#E03131';
const HANDLE_FILL = '#FFFFFF';
/** Prefix of an object's group on the equipment layer (`EquipmentLayer.tsx`). */
const OBJECT_NODE_PREFIX = 'equipment-';

export type ObjectShapeLayerProps = {
  document: PlanDocument;
  session: EditorSession;
  onCommand: CommandSink;
  /** Which object is in shape mode, or null (D-290): the app hides that object's resize and rotation handles. */
  onEditingChange?: (id: Id | null) => void;
  /**
   * #105: the object whose «Изменить форму» switch is on. A double click opens
   * the vertex mode only on this one; without the switch the click does nothing.
   */
  reshapeFor?: Id | null;
};

/** The object a double click landed on, by its group's name on the equipment layer. */
function objectIdUnder(target: Konva.Node): Id | null {
  const group = target.findAncestor(
    (node: Konva.Node) => node.getClassName() === 'Group' && node.name().startsWith(OBJECT_NODE_PREFIX),
    true,
  );
  return group === undefined || group === null ? null : group.name().slice(OBJECT_NODE_PREFIX.length);
}

const ctrlOf = (evt: unknown): boolean =>
  typeof evt === 'object' &&
  evt !== null &&
  (('ctrlKey' in evt && evt.ctrlKey === true) || ('metaKey' in evt && evt.metaKey === true));
const altOf = (evt: unknown): boolean =>
  typeof evt === 'object' && evt !== null && 'altKey' in evt && evt.altKey === true;

export function ObjectShapeLayer({
  document: plan,
  session,
  onCommand,
  onEditingChange,
  reshapeFor = null,
}: ObjectShapeLayerProps): React.JSX.Element {
  const { viewport, selection, tool } = session;
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [dragged, setDragged] = useState<Polygon | null>(null);
  const layers = new Map(plan.layers.map((layer) => [layer.id, layer]));
  const editable = (object: Equipment): boolean => {
    const layer = layers.get(object.layerId);
    return layer !== undefined && layer.visible && !layer.locked && object.locked !== true;
  };
  const object =
    editingId !== null && selection?.kind === 'object' && selection.id === editingId && tool.kind === 'select'
      ? (plan.objects.find((item) => item.id === editingId) ?? null)
      : null;
  const active = object !== null && editable(object) && object.id === reshapeFor;

  // The mode belongs to one selected object: picking something else, another
  // tool, a hidden or locked layer, or an undo that removed it ends it.
  // Reset during render, as the properties card resets its drafts.
  if (editingId !== null && !active) {
    setEditingId(null);
    setDragged(null);
  }

  // D-282: the mode's line leaves with the mode, however it ended — another
  // tool or a hidden layer ends it without a key press. A refusal printed for
  // something else is not this layer's to clear.
  useEffect(() => {
    if (!active && getNotice() === SHAPE_EDIT_NOTICE) setNotice(null);
  }, [active]);

  // D-290: report the mode however it starts or ends, so the equipment layer
  // hides this object's own handles only while the vertices are shown.
  const editedId = active ? object.id : null;
  useEffect(() => {
    onEditingChange?.(editedId);
  }, [editedId, onEditingChange]);

  // The stage's double click is the one way in: the object's own group is
  // drawn by the equipment layer, and a feature does not reach into another.
  const [groupNode, setGroupNode] = useState<Konva.Group | null>(null);
  useEffect(() => {
    const stage = groupNode?.getStage();
    if (stage === null || stage === undefined) return;
    const onDouble = (event: Konva.KonvaEventObject<MouseEvent>): void => {
      if (tool.kind !== 'select') return;
      if (groupNode?.isAncestorOf(event.target)) return;
      const id = objectIdUnder(event.target);
      const target = id === null ? undefined : plan.objects.find((item) => item.id === id);
      if (target === undefined || !editable(target) || id !== reshapeFor) return;
      setEditingId(id);
      setNotice(SHAPE_EDIT_NOTICE);
    };
    stage.on('dblclick.objectShape', onDouble);
    return () => {
      stage.off('dblclick.objectShape');
    };
  });

  // Enter or Escape closes the mode, as they close a drawn ring.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      if (isTextTarget(event.target)) return;
      event.preventDefault();
      setEditingId(null);
      setDragged(null);
      setNotice(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active) return <Group name="object-shape" ref={setGroupNode} />;

  const ring = footprint(object);
  const shown = dragged ?? ring;
  const flat = (polygon: Polygon): number[] => polygon.flatMap((point) => modelToScreen(point, viewport));
  const nodeWorld = (node: Konva.Node): Point => screenToModel([node.x(), node.y()], viewport);
  const pointerWorld = (event: Konva.KonvaEventObject<unknown>): Point | null => {
    const position = event.target.getStage()?.getPointerPosition();
    return position === undefined || position === null ? null : screenToModel([position.x, position.y], viewport);
  };
  // A vertex snaps like a zone's (D-210): to the plan's vertices and the grid, Alt keeps it under the pointer.
  const settle = (raw: Point, snapOff: boolean): Point =>
    snapOff ? roundPoint(raw) : settlePoint(snapPoint(raw, pointGuides(plan), SNAP.grid_m, SNAP.tolerance_px / viewport.scale));

  const commit = (next: Polygon): void => {
    const result = reshapeObject(object, next);
    if (!result.ok) {
      setNotice(result.reason === 'too-small' ? SHAPE_TOO_SMALL_NOTICE : SELF_INTERSECTION_NOTICE);
      return;
    }
    if (onCommand({ type: 'object.put', object: result.object }).ok) setNotice(SHAPE_EDIT_NOTICE);
  };
  const drop = (index: number): void => {
    const shrunk = removeVertex(ring, index);
    if (shrunk === null) {
      setNotice(MIN_VERTICES_NOTICE);
      return;
    }
    commit(shrunk);
  };

  return (
    <Group name="object-shape" ref={setGroupNode}>
      <Line
        name={`shape-outline-${object.id}`}
        points={flat(shown)}
        closed
        stroke={dragged !== null && !canCommitRing(dragged) ? INVALID_STROKE : SHAPE_STROKE}
        strokeWidth={2}
        listening={false}
      />
      {ring.map((from, index) => {
        const to = ring[(index + 1) % ring.length]!;
        return (
          <Line
            key={`edge-${index}`}
            name={`shape-edge-${index}`}
            points={flat([from, to])}
            stroke="transparent"
            strokeWidth={1}
            hitStrokeWidth={HANDLE_RADIUS_PX * 2}
            onPointerClick={(event) => {
              event.cancelBubble = true;
              const point = pointerWorld(event);
              if (point === null) return;
              const hit = insertionOnEdge(ring, point);
              if (hit === null) {
                setNotice(NEAR_VERTEX_NOTICE);
                return;
              }
              commit(insertVertex(ring, hit.index, hit.point));
            }}
          />
        );
      })}
      {ring.map((vertex, index) => {
        const [x, y] = modelToScreen(vertex, viewport);
        const size = HANDLE_RADIUS_PX + 2;
        return (
          <Circle
            key={`vertex-${index}`}
            name={`shape-vertex-${index}`}
            x={x}
            y={y}
            radius={size / 2 + 1}
            hitStrokeWidth={HANDLE_RADIUS_PX}
            fill={HANDLE_FILL}
            stroke={SHAPE_STROKE}
            strokeWidth={2}
            draggable
            onPointerDown={(event) => {
              event.cancelBubble = true;
            }}
            onDragMove={(event) => {
              setDragged(moveVertex(ring, index, settle(nodeWorld(event.target), altOf(event.evt))));
            }}
            onDragEnd={(event) => {
              const moved = moveVertex(ring, index, settle(nodeWorld(event.target), altOf(event.evt)));
              setDragged(null);
              // Back to the document's vertex; an accepted put re-renders it at the new place.
              event.target.position({ x, y });
              commit(moved);
            }}
            onPointerClick={(event) => {
              if (!ctrlOf(event.evt)) return;
              event.cancelBubble = true;
              drop(index);
            }}
            onDblClick={(event) => {
              event.cancelBubble = true;
              drop(index);
            }}
          />
        );
      })}
    </Group>
  );
}
