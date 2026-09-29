/**
 * Inventory numbers of new objects (D-310): the next number of the plan's own
 * series, so a desk put from the library enters the inventory with a label
 * instead of a blank the specialist has to invent.
 *
 * The series is read from the plan, not configured: numbers are split into a
 * prefix and a trailing run of digits («ИНВ-ДЕМО-053» → «ИНВ-ДЕМО-» + «053»),
 * the prefix held by most objects wins (a tie goes to the one met first in
 * plan order), and the next number is the largest in that series plus one,
 * zero-padded to the width of that largest number. Gaps are never filled: a
 * missing number usually belongs to a written-off item, and handing it to a new
 * one would merge two items in the register. A plan without a single numbered
 * object starts the team's default series `ИНВ-0001` — a team convention, not a
 * Post format, and the person can overwrite it in the card.
 */

import type { Catalog, Equipment, Id, PlanDocument } from '../../contracts/model';

/**
 * Attribute key of the inventory number: the same string as in
 * `data/catalog/object-types.json` and in the inventory list.
 */
export const INVENTORY_NUMBER_KEY = 'inventoryNumber';

/** Team default for a plan with no numbered object yet (D-310). */
export const DEFAULT_INVENTORY_SERIES = { prefix: 'ИНВ-', width: 4 } as const;

/** Read the way the inventory list reads it: trimmed string or finite number. */
export function inventoryNumberOf(object: Equipment): string | null {
  const value = object.attributes[INVENTORY_NUMBER_KEY];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A type whose objects are expected to carry a number: physical and declaring
 * the attribute in the catalog. A type the catalog does not know, a
 * non-physical mark (a socket, a sensor zone) or a type without the attribute
 * is left alone — giving it the attribute would put a field outside the
 * catalog into the file (D-266).
 */
export function carriesInventoryNumber(catalog: Catalog, typeId: Id): boolean {
  const type = catalog.objectTypes.find((entry) => entry.id === typeId);
  if (type === undefined || !type.physical) return false;
  return type.attributes.some((attribute) => attribute.key === INVENTORY_NUMBER_KEY);
}

type Parsed = { prefix: string; value: number; digits: number };

function parse(number: string): Parsed | null {
  const match = /^(.*?)(\d+)$/u.exec(number);
  if (match === null) return null;
  const [, prefix = '', digits = ''] = match;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return { prefix, value, digits: digits.length };
}

/**
 * The next free number of the plan's series. `taken` are extra numbers to
 * avoid (numbers minted earlier in the same batch); the result is added to it,
 * so a loop can mint several in a row, like `nextFreeId`.
 */
export function nextInventoryNumber(plan: PlanDocument, taken: Set<string> = new Set()): string {
  const numbers = plan.objects
    .map(inventoryNumberOf)
    .filter((number): number is string => number !== null);
  const all = [...numbers, ...taken];

  const counts = new Map<string, number>();
  for (const number of all) {
    const parsed = parse(number);
    if (parsed !== null) counts.set(parsed.prefix, (counts.get(parsed.prefix) ?? 0) + 1);
  }
  let prefix: string | null = null;
  let best = 0;
  // Map keeps insertion order, so a tie stays with the prefix met first.
  for (const [candidate, count] of counts) {
    if (count > best) {
      prefix = candidate;
      best = count;
    }
  }

  let value = 0;
  let width: number = DEFAULT_INVENTORY_SERIES.width;
  if (prefix === null) {
    prefix = DEFAULT_INVENTORY_SERIES.prefix;
  } else {
    // The largest number of the series sets both the value and the padding.
    let top: Parsed | null = null;
    for (const number of all) {
      const parsed = parse(number);
      if (parsed === null || parsed.prefix !== prefix) continue;
      if (top === null || parsed.value > top.value || (parsed.value === top.value && parsed.digits > top.digits)) {
        top = parsed;
      }
    }
    value = top?.value ?? 0;
    width = top?.digits ?? width;
  }

  const used = new Set(all);
  for (let next = value + 1; ; next += 1) {
    const candidate = `${prefix}${String(next).padStart(width, '0')}`;
    if (!used.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * The object as it should enter the plan: a type that carries a number and an
 * object without one gets the next number of the series; anything else comes
 * back unchanged. Meant for the moment an object is created, inside the same
 * command, so placing and numbering are one undo step.
 */
export function withInventoryNumber(
  plan: PlanDocument,
  object: Equipment,
  taken?: Set<string>,
): Equipment {
  if (!carriesInventoryNumber(plan.catalog, object.typeId)) return object;
  if (inventoryNumberOf(object) !== null) return object;
  return {
    ...object,
    attributes: { ...object.attributes, [INVENTORY_NUMBER_KEY]: nextInventoryNumber(plan, taken) },
  };
}
