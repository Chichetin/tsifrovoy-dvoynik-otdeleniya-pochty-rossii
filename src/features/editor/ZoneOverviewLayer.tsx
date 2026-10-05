import { useMemo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type { PlanDocument, Viewport, Issue, Metrics, Result, Ref } from '../../contracts/model';
import { zoneOverview } from '../../domain/metrics';
import { boundingBox, modelToScreen } from '../../domain/geometry';
import { formatShort } from '../../domain/number-format';

/** Pixels per metre: one stable switch shared by the overview and equipment. */
export const ZONE_OVERVIEW_SCALE = 14;

export function ZoneOverviewLayer({ document: plan, viewport, issues, metrics, onFocus }: {
  document: PlanDocument; viewport: Viewport; issues: Issue[]; metrics: Result<Metrics>; onFocus: (ref: Ref) => void;
}): React.JSX.Element {
  const cards = useMemo(() => zoneOverview(plan, issues, metrics), [plan, issues, metrics]);
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return <Group name="zone-overview">
    {plan.zones.filter((zone) => visible.has(zone.layerId)).map((zone) => {
      const card = cards.get(zone.id)!;
      const box = boundingBox(zone.polygon);
      const [x, y] = modelToScreen([(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], viewport);
      const width = Math.max(28, Math.min(150, (box.maxX - box.minX) * viewport.scale - 6));
      const height = 54;
      return <Group key={zone.id} x={x-width/2} y={y-height/2} name={`zone-overview-${zone.id}`}
        onClick={() => onFocus({ kind: 'zone', id: zone.id })} onTap={() => onFocus({ kind: 'zone', id: zone.id })}>
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
