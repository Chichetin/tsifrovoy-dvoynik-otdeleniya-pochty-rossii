/**
 * U05-ux: which zone paints which part of the plan.
 *
 * Zones nest (the client hall holds the queue and the waiting area). Filling
 * every zone with a translucent colour paints a child twice — over its parent —
 * and the child's colour stops meaning its own value. Rule: every point is
 * painted by the deepest zone that has a value. A parent with a value is filled
 * with holes where its nearest painted descendants lie; a child without a value
 * stays under its parent's colour, because it is part of the parent.
 */

import type { Id, Polygon, Zone } from '../../contracts/model';

export type PaintRegion = { zone: Zone; holes: Zone[] };

export function zonePaintRegions(
  zones: Zone[],
  hasValue: (zone: Zone) => boolean,
): PaintRegion[] {
  const byId = new Map<Id, Zone>(zones.map((zone) => [zone.id, zone]));

  /** Nearest ancestor with a value; a broken or cyclic chain ends the walk. */
  const paintedAncestor = (zone: Zone): Zone | null => {
    const seen = new Set<Id>([zone.id]);
    let parentId = zone.parentId;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (parent === undefined) return null;
      if (hasValue(parent)) return parent;
      parentId = parent.parentId;
    }
    return null;
  };

  const painted = zones.filter(hasValue);
  const holes = new Map<Id, Zone[]>(painted.map((zone) => [zone.id, []]));
  for (const zone of painted) {
    const owner = paintedAncestor(zone);
    if (owner !== null) holes.get(owner.id)?.push(zone);
  }
  return painted.map((zone) => ({ zone, holes: holes.get(zone.id) ?? [] }));
}

/**
 * Rings to fill with the even-odd rule: the zone's outline, then every hole.
 * Holes do not overlap each other (they are siblings or apart in the tree), so
 * even-odd leaves exactly the parent's own area painted.
 */
export function paintRings(region: PaintRegion): Polygon[] {
  return [region.zone.polygon, ...region.holes.map((hole) => hole.polygon)];
}
