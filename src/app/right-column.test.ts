import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RIGHT_COLUMN_KEY,
  browserStorage,
  expandSection,
  loadSectionState,
  pluralRu,
  saveSectionState,
  toggleSection,
  type SectionState,
  type SectionStorage,
} from './right-column';

function memoryStorage(initial: Record<string, string> = {}): SectionStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('loadSectionState', () => {
  it('opens everything when there is no storage', () => {
    expect(loadSectionState(null)).toEqual({});
  });

  it('opens everything on the first visit (nothing saved yet)', () => {
    expect(loadSectionState(memoryStorage())).toEqual({});
  });

  it('reads back a saved collapsed section', () => {
    const storage = memoryStorage({ [RIGHT_COLUMN_KEY]: JSON.stringify({ inventory: true }) });
    expect(loadSectionState(storage)).toEqual({ inventory: true });
  });

  it('ignores an unknown key so a stray value cannot collapse a real section', () => {
    const storage = memoryStorage({ [RIGHT_COLUMN_KEY]: JSON.stringify({ bogus: true, catalog: true }) });
    expect(loadSectionState(storage)).toEqual({ catalog: true });
  });

  it('falls back to open on corrupted JSON instead of throwing', () => {
    const storage = memoryStorage({ [RIGHT_COLUMN_KEY]: '{not json' });
    expect(loadSectionState(storage)).toEqual({});
  });

  it('falls back to open on a value that is not an object', () => {
    const storage = memoryStorage({ [RIGHT_COLUMN_KEY]: '"nope"' });
    expect(loadSectionState(storage)).toEqual({});
  });

  it('does not throw when storage.getItem throws (private mode)', () => {
    const storage: SectionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    };
    expect(loadSectionState(storage)).toEqual({});
  });
});

describe('saveSectionState', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    saveSectionState(storage, { validation: true });
    expect(loadSectionState(storage)).toEqual({ validation: true });
  });

  it('does nothing when storage is null', () => {
    expect(() => saveSectionState(null, { validation: true })).not.toThrow();
  });

  it('swallows a write failure instead of throwing', () => {
    const storage: SectionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(() => saveSectionState(storage, { validation: true })).not.toThrow();
  });
});

describe('browserStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns window.localStorage when it is reachable', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    expect(browserStorage()).toBe(storage);
  });

  it('returns null when localStorage throws (private mode)', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(browserStorage()).toBeNull();
  });
});

describe('toggleSection', () => {
  it('collapses an open section', () => {
    expect(toggleSection({}, 'properties')).toEqual({ properties: true });
  });

  it('opens a collapsed section', () => {
    expect(toggleSection({ properties: true }, 'properties')).toEqual({});
  });

  it('leaves other sections untouched', () => {
    const state: SectionState = { assistant: true };
    expect(toggleSection(state, 'properties')).toEqual({ assistant: true, properties: true });
  });
});

describe('expandSection', () => {
  it('opens a collapsed section', () => {
    expect(expandSection({ properties: true }, 'properties')).toEqual({});
  });

  it('returns the same reference when the section is already open', () => {
    const state: SectionState = { assistant: true };
    expect(expandSection(state, 'properties')).toBe(state);
  });
});

describe('pluralRu', () => {
  it('picks "one" for 1, 21, 101', () => {
    for (const count of [1, 21, 101]) {
      expect(pluralRu(count, 'находка', 'находки', 'находок')).toBe('находка');
    }
  });

  it('picks "few" for 2-4, 22-24', () => {
    for (const count of [2, 3, 4, 22, 23, 24]) {
      expect(pluralRu(count, 'находка', 'находки', 'находок')).toBe('находки');
    }
  });

  it('picks "many" for 0, 5-20, 25, 53 (declension trap: "53 объекта")', () => {
    for (const count of [0, 5, 11, 12, 13, 14, 20, 25]) {
      expect(pluralRu(count, 'находка', 'находки', 'находок')).toBe('находок');
    }
    // 53 % 10 === 3, so it takes the "few" form, not "many" — the exact case
    // the brief names («53 объекта», not «53 объектов»).
    expect(pluralRu(53, 'объект', 'объекта', 'объектов')).toBe('объекта');
  });
});
