/**
 * The inventory as a CSV file, and which catalog attributes it carries.
 *
 * Attribute columns come from the catalog of the open plan: a type with a new
 * attribute in `data/catalog/object-types.json` brings its column to the
 * inventory table and to the file without a code change. The inventory number
 * is not among them — it has a fixed column of its own.
 *
 * The table in «Инвентаризации» and the «Экспорт → CSV» item read the same
 * column choice, so the file holds the columns the person sees.
 */

import type { AttributeType, Attributes, Catalog, Id, PlanDocument } from '../contracts/model';
import { INVENTORY_NUMBER_KEY, inventoryNumberOf } from '../domain/commands';
import { planIndex } from '../domain/plan-index';

export type AttributeColumn = { key: string; label: string; type: AttributeType };

/** What the person chose by hand: key → shown or hidden. Absent keys follow the default. */
export type ColumnChoice = Record<string, boolean>;

/** One line of the file; the inventory table row has the same fields. */
export type InventoryCsvRow = {
  id: Id;
  label: string;
  inventoryNumber: string | null;
  typeId: Id;
  typeLabel: string | null;
  zoneId: Id | null;
  zoneName: string | null;
  attributes: Attributes;
};

/**
 * Every object attribute of the catalog, once per key, in catalog order. Two
 * types may declare the same key; the first label wins, because one key is one
 * column.
 */
export function attributeColumns(catalog: Catalog): AttributeColumn[] {
  const columns = new Map<string, AttributeColumn>();
  for (const type of catalog.objectTypes) {
    for (const attribute of type.attributes) {
      if (attribute.key === INVENTORY_NUMBER_KEY || columns.has(attribute.key)) continue;
      columns.set(attribute.key, { key: attribute.key, label: attribute.label, type: attribute.type });
    }
  }
  return [...columns.values()];
}

/**
 * Columns to show. A hand choice wins. Without it a column is shown when every
 * type in `typeIds` declares it: such a column has a value in every row. So the
 * whole list shows the common «Состояние», and a filter by one type shows all
 * attributes of that type. Types missing from the catalog do not vote.
 */
export function visibleAttributeColumns(
  catalog: Catalog,
  typeIds: readonly Id[],
  choice: ColumnChoice,
): AttributeColumn[] {
  const declared = new Set<Id>(typeIds);
  const types = catalog.objectTypes.filter((type) => declared.has(type.id));
  return attributeColumns(catalog).filter((column) => {
    const chosen = choice[column.key];
    if (chosen !== undefined) return chosen;
    return (
      types.length > 0 &&
      types.every((type) => type.attributes.some((attribute) => attribute.key === column.key))
    );
  });
}

/**
 * Codes of an enumerated attribute (`working`) by the label the card and the
 * colour layer show («Работает») — the table and the CSV are read by people.
 * A value the catalog has no label for stays as written.
 */
export function labelledAttributes(catalog: Catalog | undefined, attributes: Attributes): Attributes {
  let shown = attributes;
  for (const type of catalog?.layerTypes ?? []) {
    const representation = type.representation;
    if (representation.kind !== 'object-color') continue;
    const raw = attributes[representation.attribute];
    const option = typeof raw === 'string' ? representation.values.find((entry) => entry.value === raw) : undefined;
    if (option !== undefined) shown = { ...shown, [representation.attribute]: option.label };
  }
  return shown;
}

/** Rows of the whole plan in document order, the order of the plan file. */
export function inventoryCsvRows(plan: PlanDocument): InventoryCsvRow[] {
  const index = planIndex(plan);
  return plan.objects.map((object) => ({
    id: object.id,
    label: object.label,
    inventoryNumber: inventoryNumberOf(object),
    typeId: object.typeId,
    typeLabel: index.objectTypeLabel(object.typeId),
    zoneId: object.zoneId,
    zoneName: object.zoneId === null ? null : index.zoneName(object.zoneId),
    attributes: labelledAttributes(plan.catalog, object.attributes),
  }));
}

/**
 * An attribute value as text: `да` / `нет` for a flag, `null` for no value.
 * Numbers keep the machine format: the file is for Excel, not for reading.
 */
export function attributeText(value: Attributes[string] | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Fixed columns of the file, in the order the table shows them. */
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
 * preferences: without them the export opens as garbage (D-160).
 */
export const CSV_SEPARATOR = ';';
export const CSV_BOM = '\uFEFF';

/**
 * Rows of text → CSV, RFC 4180: a cell that holds the separator, a quote or a
 * line break is wrapped in quotes and its own quotes are doubled. Leading and
 * trailing spaces are quoted too, because a spreadsheet eats them otherwise.
 * Lines end with CRLF — that is what the standard says and what Excel expects.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => cells.map(csvCell).join(CSV_SEPARATOR)).join('\r\n');
}

/** A cell starting with one of these is read by Excel as a formula, not text. */
const FORMULA_STARTERS = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  // Formula injection: a name like «=HYPERLINK(...)» or an inventory number
  // «-12» in someone else's plan must open as text. A leading apostrophe is
  // what spreadsheets themselves use to say «this is text» (OWASP guidance).
  const text = FORMULA_STARTERS.test(value) ? `'${value}` : value;
  const risky =
    text !== value ||
    text.includes(CSV_SEPARATOR) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.trim() !== text;
  return risky ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The inventory as a file: the header, then one line per row in the given
 * order. Names and ids both travel, because the file is read by a person and
 * matched back to the plan by id. Attribute columns follow the fixed ones.
 */
export function inventoryCsv(
  rows: readonly InventoryCsvRow[],
  columns: readonly AttributeColumn[],
): string {
  const header = [...CSV_COLUMNS, ...columns.map((column) => column.label)];
  const body = rows.map((row) => [
    row.inventoryNumber ?? '',
    row.label,
    row.id,
    row.typeLabel ?? row.typeId,
    row.typeId,
    row.zoneId === null ? 'вне зон' : (row.zoneName ?? row.zoneId),
    row.zoneId ?? '',
    ...columns.map((column) => attributeText(row.attributes[column.key]) ?? ''),
  ]);
  return CSV_BOM + toCsv([header, ...body]);
}

/** `Демо-ОПС «Синтетическое»` → `Демо-ОПС-Синтетическое-инвентаризация.csv`. */
export function inventoryCsvFileName(plan: PlanDocument | undefined): string {
  const stem = (plan?.name ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
  return `${stem === '' ? 'plan' : stem}-инвентаризация.csv`;
}

const CHOICE_STORAGE_KEY = 'posttech:inventory-attribute-columns';

/**
 * The choice lives in the browser, not in the plan: it is how this person
 * looks at the list. Broken or missing data means «no choice».
 */
export function loadColumnChoice(): ColumnChoice {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CHOICE_STORAGE_KEY) ?? 'null');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const choice: ColumnChoice = {};
    for (const [key, shown] of Object.entries(value)) {
      if (typeof shown === 'boolean') choice[key] = shown;
    }
    return choice;
  } catch {
    return {};
  }
}

export function saveColumnChoice(choice: ColumnChoice): void {
  try {
    window.localStorage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Without storage the choice still holds for this session.
  }
}
