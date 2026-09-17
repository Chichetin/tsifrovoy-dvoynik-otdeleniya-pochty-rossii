/**
 * U03 (shapes): the room, its zones, walls and openings.
 *
 * Everything here reads the document and draws it; nothing is stored. Zone
 * colour comes from the catalog, so a zone type added to data/catalog shows up
 * on the plan without a line of code changing.
 *
 * Nested zones are drawn deepest last: a waiting area inside a client area has
 * to stay visible and clickable, and its own fill must win.
 */

import { Layer, Line, Text } from 'react-konva';
import type { Id, Point, Polygon, Zone } from '../../contracts/model';
import type { PlanGeometryLayerProps } from '../../contracts/ui';
import { findZoneType } from '../../domain/catalog';
import { modelToScreen, wallPolygon } from '../../domain/geometry';
import { zoneDepth } from '../../domain/relations';

const ROOM_STROKE = '#212529';
const WALL_FILL = '#495057';
const OPENING_FILL = '#FFFFFF';
const DRAFT_STROKE = '#1971C2';
const SELECTED_STROKE = '#1971C2';
const ZONE_FALLBACK = '#E9ECEF';

function flatten(polygon: Polygon, viewport: PlanGeometryLayerProps['session']['viewport']): number[] {
  return polygon.flatMap((point) => modelToScreen(point, viewport));
}

/** Midpoint of the polygon's extent — good enough to hang a zone label on. */
function labelAnchor(polygon: Polygon): Point {
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
}

export function PlanGeometryLayer({
  document: plan,
  session,
  draft,
  onSelect,
}: PlanGeometryLayerProps): React.JSX.Element {
  const { viewport, selection } = session;
  const isSelected = (kind: string, id: Id): boolean =>
    selection?.kind === kind && selection.id === id;

  const visibleLayers = new Set(
    plan.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );
  const zones: Zone[] = plan.zones
    .filter((zone) => visibleLayers.has(zone.layerId))
    .slice()
    .sort((a, b) => (zoneDepth(a.id, plan.zones) ?? 0) - (zoneDepth(b.id, plan.zones) ?? 0));

  return (
    <Layer>
      <Line
        points={flatten(plan.room.boundary, viewport)}
        closed
        fill="#F8F9FA"
        stroke={isSelected('room', plan.room.id) ? SELECTED_STROKE : ROOM_STROKE}
        strokeWidth={2}
        onPointerClick={() => onSelect({ kind: 'room', id: plan.room.id })}
      />

      {zones.map((zone) => (
        <Line
          key={zone.id}
          points={flatten(zone.polygon, viewport)}
          closed
          fill={findZoneType(plan.catalog, zone.typeId)?.color ?? ZONE_FALLBACK}
          opacity={0.75}
          stroke={isSelected('zone', zone.id) ? SELECTED_STROKE : '#ADB5BD'}
          strokeWidth={isSelected('zone', zone.id) ? 2.5 : 1}
          onPointerClick={() => onSelect({ kind: 'zone', id: zone.id })}
        />
      ))}

      {zones.map((zone) => {
        const [x, y] = modelToScreen(labelAnchor(zone.polygon), viewport);
        return (
          <Text
            key={`label-${zone.id}`}
            x={x - 60}
            y={y - 7}
            width={120}
            align="center"
            text={zone.name}
            fontSize={12}
            fill="#495057"
            listening={false}
          />
        );
      })}

      {plan.walls.map((wall) => (
        <Line
          key={wall.id}
          points={flatten(wallPolygon(wall), viewport)}
          closed
          fill={WALL_FILL}
          stroke={isSelected('wall', wall.id) ? SELECTED_STROKE : WALL_FILL}
          strokeWidth={isSelected('wall', wall.id) ? 2.5 : 1}
          onPointerClick={() => onSelect({ kind: 'wall', id: wall.id })}
        />
      ))}

      {plan.openings.map((opening) => {
        const wall = plan.walls.find((entry) => entry.id === opening.wallId);
        if (wall === undefined) return null;
        const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
        if (length === 0) return null;
        const ux = (wall.to[0] - wall.from[0]) / length;
        const uy = (wall.to[1] - wall.from[1]) / length;
        const at = (along: number): Point => [
          wall.from[0] + ux * along,
          wall.from[1] + uy * along,
        ];
        return (
          <Line
            key={opening.id}
            points={flatten(
              [at(opening.offset_m), at(opening.offset_m + opening.width_m)],
              viewport,
            )}
            stroke={isSelected('opening', opening.id) ? SELECTED_STROKE : OPENING_FILL}
            strokeWidth={Math.max(3, wall.thickness_m * viewport.scale)}
            onPointerClick={() => onSelect({ kind: 'opening', id: opening.id })}
          />
        );
      })}

      {draft === null || draft.length === 0 ? null : (
        <Line
          points={flatten(draft, viewport)}
          stroke={DRAFT_STROKE}
          strokeWidth={2}
          dash={[6, 4]}
          closed={draft.length > 2}
          listening={false}
        />
      )}
    </Layer>
  );
}
