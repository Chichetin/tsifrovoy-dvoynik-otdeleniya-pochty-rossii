import { useMemo } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import type { PlanDocument, Viewport, Issue, Metrics, Result, Ref } from '../../contracts/model';
import { zoneOverview } from '../../domain/metrics';
import { boundingBox, modelToScreen } from '../../domain/geometry';
import { formatShort } from '../../domain/number-format';
import { placeZoneCaption, type CaptionBox } from '../../domain/zone-caption-layout';
import { zoneDepth } from '../../domain/relations';

/** Pixels per metre: one stable switch shared by the overview and equipment. */
export const ZONE_OVERVIEW_SCALE = 14;

export function ZoneOverviewLayer({ document: plan, viewport, issues, metrics, onFocus }: {
  document: PlanDocument; viewport: Viewport; issues: Issue[]; metrics: Result<Metrics>; onFocus?: (ref: Ref) => void;
}): React.JSX.Element {
  const cards = useMemo(() => zoneOverview(plan, issues, metrics), [plan, issues, metrics]);
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const positions = useMemo(() => {
    const obstacles: CaptionBox[] = [];
    const result = new Map<string, CaptionBox>();
    const layers = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
    const zones = plan.zones.filter((zone) => layers.has(zone.layerId)).sort((a, b) =>
      (zoneDepth(b.id, plan.zones) ?? 0) - (zoneDepth(a.id, plan.zones) ?? 0));
    for (const zone of zones) {
      const polygon = zone.polygon.map((point) => modelToScreen(point, viewport));
      const bounds = boundingBox(polygon);
      const width = Math.max(110, Math.min(150, bounds.maxX - bounds.minX - 6));
      let box = placeZoneCaption(polygon, width, 54, obstacles);
      const clear = (candidate: CaptionBox): boolean => obstacles.every((other) =>
        candidate.x + candidate.width + 3 <= other.x || other.x + other.width + 3 <= candidate.x ||
        candidate.y + candidate.height + 3 <= other.y || other.y + other.height + 3 <= candidate.y);
      // At a distant zoom there is not enough room inside a tiny zone. Place
      // its card nearby with a leader, instead of covering another card.
      if (!clear(box)) {
        search: for (let ring = 1; ring <= 8; ring += 1) {
          for (let dy = -ring; dy <= ring; dy += 1) for (let dx = -ring; dx <= ring; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const candidate = { ...box, x: box.x + dx * (width + 6), y: box.y + dy * 60 };
            if (clear(candidate)) { box = candidate; break search; }
          }
        }
      }
      result.set(zone.id, box); obstacles.push(box);
    }
    return result;
  }, [plan.layers, plan.zones, viewport]);
  return <Group name="zone-overview">
    {plan.zones.filter((zone) => visible.has(zone.layerId)).map((zone) => {
      const card = cards.get(zone.id)!;
      const { x, y, width, height } = positions.get(zone.id)!;
      const bounds = boundingBox(zone.polygon);
      const anchor = modelToScreen([(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2], viewport);
      return <Group key={zone.id} x={x} y={y} name={`zone-overview-${zone.id}`} listening={onFocus !== undefined}
        onClick={() => onFocus?.({ kind: 'zone', id: zone.id })} onTap={() => onFocus?.({ kind: 'zone', id: zone.id })}>
        <Line points={[anchor[0]-x, anchor[1]-y, width/2, height/2]} stroke="#AAB7C4" strokeWidth={1} listening={false} />
        <Rect width={width} height={height} cornerRadius={4} fill="#FFFFFF" opacity={0.96}
          stroke={card.findings > 0 ? '#A15C00' : '#AAB7C4'} strokeWidth={1} />
        <Text width={width} height={22} y={2} padding={1} text={zone.name} fontSize={9} fontStyle="bold"
          align="center" ellipsis wrap="word" fill="#212529" />
        <Text width={width} y={24} text={`${card.area_m2 === null ? '—' : formatShort(card.area_m2)} м²`}
          fontSize={9} align="center" fill="#212529" />
        <Text width={width} y={34} text={`${card.objects} об.`} fontSize={9} align="center" fill="#212529" />
        <Text width={width} y={44} text={`${card.findings} находок`} fontSize={9} align="center"
          fill={card.findings > 0 ? '#A15C00' : '#495057'} />
      </Group>;
    })}
  </Group>;
}
