/**
 * UI-2Б: which right-column sections are collapsed, without any DOM.
 *
 * The same pattern as the first-run tour (`features/onboarding/tour.ts`,
 * D-195): the fact lives in `localStorage` only, under a versioned,
 * project-prefixed key, and every access is wrapped so a browser that refuses
 * storage (private mode, a full quota) still renders — with every section
 * open, since a record with nothing collapsed in it looks the same as an
 * empty one.
 */

export type SectionId = 'properties' | 'assistant' | 'metrics' | 'validation' | 'inventory' | 'catalog';

export const SECTION_IDS: readonly SectionId[] = [
  'properties',
  'assistant',
  'metrics',
  'validation',
  'inventory',
  'catalog',
];

/** `true` = collapsed. A section missing from the record is open — the default. */
export type SectionState = Partial<Record<SectionId, boolean>>;

/** Versioned: a reshaped set of sections gets a new key and opens fresh. */
export const RIGHT_COLUMN_KEY = 'ops-twin.right-column.v1';

/** The slice of `localStorage` this module uses, so tests can pass their own. */
export type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, if it is reachable at all: private mode throws on access. */
export function browserStorage(): SectionStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * All open on the first visit, when the browser cannot tell, and when the
 * saved value is not the shape this module wrote — a foreign or corrupted
 * value must never collapse a section the user never touched.
 */
export function loadSectionState(storage: SectionStorage | null): SectionState {
  if (storage === null) return {};
  try {
    const raw = storage.getItem(RIGHT_COLUMN_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    // Guards `null` (typeof 'object', but indexing it throws) and every
    // other JSON shape that is not a plain record in one place, instead of a
    // separate early return the try/catch below would make unreachable to a
    // test anyway.
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const state: SectionState = {};
    for (const id of SECTION_IDS) {
      if (record[id] === true) state[id] = true;
    }
    return state;
  } catch {
    return {};
  }
}

/** Refused silently: the column stays as it is in this tab, nothing else breaks. */
export function saveSectionState(storage: SectionStorage | null, state: SectionState): void {
  if (storage === null) return;
  try {
    storage.setItem(RIGHT_COLUMN_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota: not this module's job to surface that.
  }
}

/** A copy of `state` with `id` dropped — an absent key means "open". */
function without(state: SectionState, id: SectionId): SectionState {
  const rest: SectionState = {};
  for (const key of SECTION_IDS) {
    if (key !== id && state[key] === true) rest[key] = true;
  }
  return rest;
}

/** Flips one section; the rest of the record is untouched. */
export function toggleSection(state: SectionState, id: SectionId): SectionState {
  return state[id] === true ? without(state, id) : { ...state, [id]: true };
}

/** Opens one section if it was collapsed; returns the same record otherwise
 * (a stable reference lets a caller skip a re-render when nothing changed). */
export function expandSection(state: SectionState, id: SectionId): SectionState {
  return state[id] === true ? without(state, id) : state;
}

/**
 * A count word in Russian: «1 находка», «3 находки», «5 находок». The
 * standard one/few/many split by the last two digits.
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}
