import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDE_TABS,
  LEFT_TABS,
  RIGHT_TABS,
  SIDE_TABS_KEY,
  loadSideTabs,
  saveSideTabs,
  tabAfterKey,
  type TabStorage,
} from './side-tabs';

function memoryStorage(initial: Record<string, string> = {}): TabStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('loadSideTabs', () => {
  it('opens the working tabs without storage or on the first visit', () => {
    expect(loadSideTabs(null)).toEqual({ left: 'library', right: 'inventory' });
    expect(loadSideTabs(memoryStorage())).toEqual(DEFAULT_SIDE_TABS);
  });

  it('restores what was saved', () => {
    const storage = memoryStorage();
    saveSideTabs(storage, { left: 'layers', right: 'validation' });
    expect(storage.data.get(SIDE_TABS_KEY)).toBe('{"left":"layers","right":"validation"}');
    expect(loadSideTabs(storage)).toEqual({ left: 'layers', right: 'validation' });
  });

  it('checks each column on its own: a stale value falls back only in its column', () => {
    const storage = memoryStorage({ [SIDE_TABS_KEY]: '{"left":"layers","right":"properties"}' });
    expect(loadSideTabs(storage)).toEqual({ left: 'layers', right: 'inventory' });
    const other = memoryStorage({ [SIDE_TABS_KEY]: '{"left":42,"right":"catalog"}' });
    expect(loadSideTabs(other)).toEqual({ left: 'library', right: 'catalog' });
  });

  it('falls back to defaults on garbage, null and a throwing storage', () => {
    expect(loadSideTabs(memoryStorage({ [SIDE_TABS_KEY]: 'not json' }))).toEqual(DEFAULT_SIDE_TABS);
    expect(loadSideTabs(memoryStorage({ [SIDE_TABS_KEY]: 'null' }))).toEqual(DEFAULT_SIDE_TABS);
    const throwing: TabStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSideTabs(throwing)).toEqual(DEFAULT_SIDE_TABS);
    expect(() => saveSideTabs(throwing, DEFAULT_SIDE_TABS)).not.toThrow();
  });
});

describe('tabAfterKey', () => {
  it('moves with arrows and wraps at both ends', () => {
    expect(tabAfterKey(RIGHT_TABS, 'assistant', 'ArrowRight')).toBe('metrics');
    expect(tabAfterKey(RIGHT_TABS, 'catalog', 'ArrowRight')).toBe('assistant');
    expect(tabAfterKey(RIGHT_TABS, 'metrics', 'ArrowLeft')).toBe('assistant');
    expect(tabAfterKey(RIGHT_TABS, 'assistant', 'ArrowLeft')).toBe('catalog');
    expect(tabAfterKey(LEFT_TABS, 'layers', 'ArrowRight')).toBe('library');
  });

  it('jumps with Home and End and ignores other keys', () => {
    expect(tabAfterKey(RIGHT_TABS, 'validation', 'Home')).toBe('assistant');
    expect(tabAfterKey(RIGHT_TABS, 'validation', 'End')).toBe('catalog');
    expect(tabAfterKey(RIGHT_TABS, 'validation', 'Enter')).toBeNull();
    expect(tabAfterKey(RIGHT_TABS, 'validation', 'ArrowDown')).toBeNull();
  });
});
