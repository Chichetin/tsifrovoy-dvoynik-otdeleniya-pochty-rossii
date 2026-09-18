/**
 * M02 (rows): what the inventory table shows, prepared without React.
 *
 * The panel must never invent a second copy of the plan, so every human name
 * here is looked up in the document itself: type labels in `plan.catalog`,
 * zone names in `plan.zones`. An id with no name behind it — a type deleted
 * from the catalog mid-edit, a zone that went away — keeps showing the raw id
 * instead of a blank cell, because a blank cell is how an object disappears
 * from an inventory.
 *
 * No counting happens here either: `buildInventory` has already counted, and
 * these functions only group, name and filter what it returned.
 */

import type { Equipment, Id, Inventory, PlanDocument } from '../../contracts/model';

/** Human names for ids taken from the plan; `null` means "no such id there". */
export type Naming = {
  typeLabel: (typeId: Id) => string | null;
  zoneName: (zoneId: Id) => string | null;
};

/** Every id stays raw: the panel is rendered without a document. */
export const RAW_IDS: Naming = { typeLabel: () => null, zoneName: () => null };

export function namingOf(plan: PlanDocument | undefined): Naming {
  if (plan === undefined) return RAW_IDS;
  const types = new Map(plan.catalog.objectTypes.map((type) => [type.id, type.label]));
  const zones = new Map(plan.zones.map((zone) => [zone.id, zone.name]));
  return {
    typeLabel: (typeId) => types.get(typeId) ?? null,
    zoneName: (zoneId) => zones.get(zoneId) ?? null,
  };
}

export type TypeSummaryRow = { typeId: Id; label: string | null; count: number };

export type ZoneSummaryRow = {
  zoneId: Id;
  name: string | null;
  direct: number;
  inclusive: number;
};

export type ObjectRow = {
  id: Id;
  label: string;
  typeId: Id;
  typeLabel: string | null;
  zoneId: Id | null;
  zoneName: string | null;
  /** Lowercased haystack for the filter: ids, names and attribute values. */
  haystack: string;
};

export type InventoryFilter = { query: string; typeId: Id | null };

/** What to show when a name is missing: the id, never an empty cell. */
export function display(name: string | null, id: Id): string {
  return name ?? id;
}

/**
 * The by-type summary of the panel. Only types that are actually placed get a
 * line: the catalog holds dozens of them, and a screen of zeroes hides the two
 * numbers a branch manager came for. How many types stayed out is reported
 * separately by `absentTypes`.
 *
 * Heaviest first — that is the order in which surplus and shortage are read —
 * and equal counts keep a stable order by name, so a move on the plan does not
 * reshuffle the summary.
 */
export function typeSummary(inventory: Inventory, naming: Naming): TypeSummaryRow[] {
  return Object.entries(inventory.byType)
    .filter(([, count]) => count > 0)
    .map(([typeId, count]) => ({ typeId, label: naming.typeLabel(typeId), count }))
    .sort(
      (a, b) =>
        b.count - a.count || display(a.label, a.typeId).localeCompare(display(b.label, b.typeId), 'ru'),
    );
}

/** Types known to the plan but not placed anywhere. */
export function absentTypes(inventory: Inventory): number {
  return Object.values(inventory.byType).filter((count) => count === 0).length;
}

/** Zones in document order: the summary must not reshuffle itself between edits. */
export function zoneSummary(inventory: Inventory, naming: Naming): ZoneSummaryRow[] {
  return Object.entries(inventory.byZoneDirect).map(([zoneId, direct]) => ({
    zoneId,
    name: naming.zoneName(zoneId),
    direct,
    inclusive: inventory.byZoneInclusive[zoneId] ?? 0,
  }));
}

export function objectRows(inventory: Inventory, naming: Naming): ObjectRow[] {
  return inventory.rows.map((object) => {
    const typeLabel = naming.typeLabel(object.typeId);
    const zoneName = object.zoneId === null ? null : naming.zoneName(object.zoneId);
    return {
      id: object.id,
      label: object.label,
      typeId: object.typeId,
      typeLabel,
      zoneId: object.zoneId,
      zoneName,
      haystack: haystackOf(object, typeLabel, zoneName),
    };
  });
}

/**
 * Filtering is an AND over words: «скамья ожидание» finds the bench in the
 * waiting zone and not every bench plus every object of that zone. Attribute
 * values are part of the haystack, so an inventory number typed from a sticker
 * finds its object without the panel knowing which attribute key holds it.
 */
export function filterObjectRows(rows: ObjectRow[], filter: InventoryFilter): ObjectRow[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter((term) => term !== '');
  return rows.filter((row) => {
    if (filter.typeId !== null && row.typeId !== filter.typeId) return false;
    return terms.every((term) => row.haystack.includes(term));
  });
}

function haystackOf(object: Equipment, typeLabel: string | null, zoneName: string | null): string {
  const parts: (string | null)[] = [
    object.id,
    object.label,
    object.typeId,
    typeLabel,
    object.zoneId,
    zoneName,
  ];
  for (const value of Object.values(object.attributes)) {
    if (typeof value === 'string' || typeof value === 'number') parts.push(String(value));
  }
  return parts.filter((part) => part !== null).join(' ').toLowerCase();
}
