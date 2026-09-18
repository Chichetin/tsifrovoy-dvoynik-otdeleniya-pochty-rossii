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
  /** The sticker on the item; `null` when the object carries no such attribute. */
  inventoryNumber: string | null;
  typeId: Id;
  typeLabel: string | null;
  zoneId: Id | null;
  zoneName: string | null;
  /** Lowercased haystack for the filter: ids, names and attribute values. */
  haystack: string;
};

export type InventoryFilter = { query: string; typeId: Id | null };

/**
 * The attribute that holds the inventory number. It is an ordinary catalog
 * attribute — every object type in `data/catalog/object-types.json` declares
 * it, and a plan that omits it stays valid — but the inventory list needs it
 * as a column of its own, so its key is named here once.
 */
export const INVENTORY_NUMBER_KEY = 'inventoryNumber';

/** What the column shows for an object without an inventory number. */
export const NO_INVENTORY_NUMBER = '—';

export type SortColumn = 'inventoryNumber' | 'label' | 'type' | 'zone';

export type InventorySort = { column: SortColumn; direction: 'asc' | 'desc' };

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

/**
 * «1 тип», «2 типа», «5 типов» — the note about absent types is shown with a
 * number, and a Russian interface that says «1 типов» reads as a bug.
 */
export function typesWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'типов';
  if (ones === 1) return 'тип';
  if (ones >= 2 && ones <= 4) return 'типа';
  return 'типов';
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
      inventoryNumber: inventoryNumberOf(object),
      typeId: object.typeId,
      typeLabel,
      zoneId: object.zoneId,
      zoneName,
      haystack: haystackOf(object, typeLabel, zoneName),
    };
  });
}

/**
 * A number is accepted as well as a string: the catalog declares the attribute
 * as `string`, but a file written by hand can hold `1024`, and a specialist
 * looking for item 1024 must still find it. Anything else — an object, a
 * boolean, an empty string — counts as "no number", not as a printed `[object
 * Object]`.
 */
function inventoryNumberOf(object: Equipment): string | null {
  const value = object.attributes[INVENTORY_NUMBER_KEY];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
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

/**
 * Sorting by a column. `null` keeps the document order, which is the order the
 * plan file lists its objects in and the only order that matches the 2D canvas
 * — a user who has not asked for anything else gets it.
 *
 * Empty cells always go last, in both directions: an object without an
 * inventory number is the one to be found at the end of the list, never the
 * first thing a specialist sees after clicking «Инв. №» twice. Ties are broken
 * by `id`, so the order is total and a redraw never reshuffles equal rows.
 */
export function sortObjectRows(rows: ObjectRow[], sort: InventorySort | null): ObjectRow[] {
  if (sort === null) return rows;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortKey(a, sort.column);
    const right = sortKey(b, sort.column);
    if (left === null || right === null) {
      if (left === right) return compareText(a.id, b.id);
      return left === null ? 1 : -1;
    }
    return sign * compareText(left, right) || compareText(a.id, b.id);
  });
}

function sortKey(row: ObjectRow, column: SortColumn): string | null {
  switch (column) {
    case 'inventoryNumber':
      return row.inventoryNumber;
    case 'label':
      return row.label;
    case 'type':
      return display(row.typeLabel, row.typeId);
    case 'zone':
      return row.zoneId === null ? null : display(row.zoneName, row.zoneId);
  }
}

/**
 * `numeric` is what makes «ИНВ-ДЕМО-2» come before «ИНВ-ДЕМО-10» instead of
 * after it: inventory numbers are read as text with a number inside.
 */
function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' });
}

/** Columns of the exported file, in the order the table shows them. */
export const CSV_COLUMNS = [
  'Инв. №',
  'Объект',
  'id объекта',
  'Тип',
  'id типа',
  'Зона',
  'id зоны',
] as const;

/**
 * Excel on a Russian Windows splits a `.csv` by the list separator of the
 * locale, which is `;` — a comma-separated file lands in one column. The BOM
 * is what makes the same Excel read the bytes as UTF-8 instead of cp1251, so
 * «Инв. №» does not arrive as «Ð˜Ð½Ð²». Both are file-format decisions, not
 * preferences: without them the export opens as garbage (D-139).
 */
export const CSV_SEPARATOR = ';';
export const CSV_BOM = '﻿';

/**
 * Rows of text → CSV, RFC 4180: a cell that holds the separator, a quote or a
 * line break is wrapped in quotes and its own quotes are doubled. Leading and
 * trailing spaces are quoted too, because a spreadsheet eats them otherwise.
 * Lines end with CRLF — that is what the standard says and what Excel expects.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => cells.map(csvCell).join(CSV_SEPARATOR)).join('\r\n');
}

function csvCell(value: string): string {
  const risky =
    value.includes(CSV_SEPARATOR) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.trim() !== value;
  return risky ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The inventory as a file: the header, then one line per row in the order the
 * table shows them. Names and ids both travel, because the file is read by a
 * person and matched back to the plan by id.
 */
export function inventoryCsv(rows: readonly ObjectRow[]): string {
  const body = rows.map((row) => [
    row.inventoryNumber ?? '',
    row.label,
    row.id,
    display(row.typeLabel, row.typeId),
    row.typeId,
    row.zoneId === null ? 'вне зон' : display(row.zoneName, row.zoneId),
    row.zoneId ?? '',
  ]);
  return CSV_BOM + toCsv([[...CSV_COLUMNS], ...body]);
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
