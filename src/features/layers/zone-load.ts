/**
 * #15: zones of a `zone-heat` layer ranked by their value, highest first.
 *
 * The values are zone attributes a person entered; nothing is measured here.
 * A zone counts as overloaded from the value that saturates the scale
 * (`representation.max` in the catalog) — the same point where the canvas
 * colour stops changing, so the list and the plan never disagree.
 */

import type { Id, LayerType, Zone } from '../../contracts/model';

export type ZoneLoadRow = {
  zoneId: Id;
  name: string;
  value: number;
  /** Part of the scale filled, 0…1. */
  share: number;
  overloaded: boolean;
};

export type ZoneLoad = {
  rows: ZoneLoadRow[];
  /** Zones without a value: they are not ranked. */
  missing: number;
};

type ZoneHeat = Extract<LayerType['representation'], { kind: 'zone-heat' }>;

export function zoneLoad(zones: Zone[], representation: ZoneHeat): ZoneLoad {
  const rows: ZoneLoadRow[] = [];
  for (const zone of zones) {
    const value = zone.attributes[representation.attribute];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const share = representation.max > 0 ? Math.min(Math.max(value / representation.max, 0), 1) : 0;
    rows.push({ zoneId: zone.id, name: zone.name, value, share, overloaded: value >= representation.max });
  }
  // Equal values keep the plan order: the list does not shuffle on every edit.
  rows.sort((a, b) => b.value - a.value);
  return { rows, missing: zones.length - rows.length };
}
