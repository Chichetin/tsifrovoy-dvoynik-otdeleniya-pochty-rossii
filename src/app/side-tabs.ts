/**
 * D-249: which tab each side column shows, without any DOM.
 *
 * The open tab is a fact about this browser, not about the plan: it lives in
 * `localStorage` under a versioned, project-prefixed key (the same pattern as
 * the first-run tour, D-195) and never reaches the plan file. Every storage
 * access is wrapped, so a browser that refuses storage still renders with the
 * default tab of each column open.
 */

export type LeftTab = 'layers' | 'library';
export type RightTab = 'assistant' | 'metrics' | 'validation' | 'inventory' | 'catalog';

export type TabDef<T extends string> = { id: T; title: string };

export const LEFT_TABS: readonly TabDef<LeftTab>[] = [
  { id: 'layers', title: 'Слои' },
  { id: 'library', title: 'Библиотека' },
];

export const RIGHT_TABS: readonly TabDef<RightTab>[] = [
  { id: 'assistant', title: 'Ассистент' },
  { id: 'metrics', title: 'Площади' },
  { id: 'validation', title: 'Проверка' },
  { id: 'inventory', title: 'Инвентаризация' },
  { id: 'catalog', title: 'Справочник' },
];

export type SideTabs = { left: LeftTab; right: RightTab };

/**
 * What a new browser sees: the working tab of each column, not the first one.
 * The library is where equipment is placed from; the inventory is the plan's
 * overview right after «Открыть». The assistant has its own entry point (the
 * floating launcher switches to its tab), layers are an occasional task.
 */
export const DEFAULT_SIDE_TABS: SideTabs = { left: 'library', right: 'inventory' };

/** Versioned: a reshaped set of tabs gets a new key and starts fresh. */
export const SIDE_TABS_KEY = 'ops-twin.side-tabs.v1';

/** The slice of `localStorage` this module uses, so tests can pass their own. */
export type TabStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, if it is reachable at all: private mode throws on access. */
export function browserStorage(): TabStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function pick<T extends string>(tabs: readonly TabDef<T>[], value: unknown, fallback: T): T {
  return tabs.find((tab) => tab.id === value)?.id ?? fallback;
}

/**
 * The saved tabs, each column checked on its own: a foreign or stale value in
 * one column falls back to that column's first tab and leaves the other alone.
 */
export function loadSideTabs(storage: TabStorage | null): SideTabs {
  if (storage === null) return DEFAULT_SIDE_TABS;
  try {
    const raw = storage.getItem(SIDE_TABS_KEY);
    if (raw === null) return DEFAULT_SIDE_TABS;
    const parsed: unknown = JSON.parse(raw);
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return {
      left: pick(LEFT_TABS, record.left, DEFAULT_SIDE_TABS.left),
      right: pick(RIGHT_TABS, record.right, DEFAULT_SIDE_TABS.right),
    };
  } catch {
    return DEFAULT_SIDE_TABS;
  }
}

/** Refused silently: the tabs stay as they are in this browser tab. */
export function saveSideTabs(storage: TabStorage | null, tabs: SideTabs): void {
  if (storage === null) return;
  try {
    storage.setItem(SIDE_TABS_KEY, JSON.stringify(tabs));
  } catch {
    // Private mode or a full quota: not this module's job to surface that.
  }
}

/**
 * The tab a key moves to in a horizontal tablist (WAI-ARIA tabs pattern):
 * arrows wrap around, Home and End jump to the ends. `null` — the key is not
 * a tab-navigation key and must be left to the browser.
 */
export function tabAfterKey<T extends string>(tabs: readonly TabDef<T>[], current: T, key: string): T | null {
  const index = tabs.findIndex((tab) => tab.id === current);
  if (index < 0 || tabs.length === 0) return null;
  const last = tabs.length - 1;
  if (key === 'ArrowRight') return tabs[index === last ? 0 : index + 1]!.id;
  if (key === 'ArrowLeft') return tabs[index === 0 ? last : index - 1]!.id;
  if (key === 'Home') return tabs[0]!.id;
  if (key === 'End') return tabs[last]!.id;
  return null;
}
