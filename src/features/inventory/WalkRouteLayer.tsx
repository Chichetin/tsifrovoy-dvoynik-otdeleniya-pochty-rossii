/**
 * #124: the route of the inventory walk over the plan. A dashed line goes from
 * the entrance through the objects in the order of the walk; marked objects get
 * a small dot of their mark's colour, the current object a ring. The layer only
 * draws: it never takes a click from the objects below it.
 */

import { Circle, Group, Line } from 'react-konva';
import type { Id, PlanDocument, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { type WalkMark, walkMarkOf, walkStart } from '../../domain/inventory';

export type WalkRouteLayerProps = {
  document: PlanDocument;
  viewport: Viewport;
  route: readonly Id[];
  currentId: Id | null;
};

const ROUTE_COLOR = '#0B5CAD';
const CURRENT_COLOR = '#E8590C';
const MARK_COLORS: Record<WalkMark, string> = {
  present: '#2B8A3E',
  missing: '#C92A2A',
  'other-number': '#E67700',
  broken: '#862E9C',
};

export function WalkRouteLayer({ document: plan, viewport, route, currentId }: WalkRouteLayerProps): React.JSX.Element {
  const objects = new Map(plan.objects.map((object) => [object.id, object]));
  const steps = route.flatMap((id) => {
    const object = objects.get(id);
    return object === undefined ? [] : [object];
  });
  const points = [walkStart(plan), ...steps.map((object) => object.position)].flatMap((point) =>
    modelToScreen(point, viewport),
  );
  const current = currentId === null ? undefined : objects.get(currentId);

  return (
    <Group listening={false} name="inventory-walk">
      <Line points={points} stroke={ROUTE_COLOR} strokeWidth={2} dash={[6, 4]} opacity={0.7} />
      {steps.map((object) => {
        const mark = walkMarkOf(object);
        if (mark === null) return null;
        const [x, y] = modelToScreen(object.position, viewport);
        return <Circle key={object.id} x={x} y={y} radius={4} fill={MARK_COLORS[mark]} stroke="#FFFFFF" strokeWidth={1} />;
      })}
      {current === undefined ? null : (() => {
        const [x, y] = modelToScreen(current.position, viewport);
        return <Circle x={x} y={y} radius={14} stroke={CURRENT_COLOR} strokeWidth={4} shadowColor="#FFFFFF" shadowBlur={4} />;
      })()}
    </Group>
  );
}
