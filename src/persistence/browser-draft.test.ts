/**
 * IO03: the local draft is a safety net, never a second source of truth.
 *
 * Everything here is checked against a storage that behaves the way a real
 * browser can misbehave: full, disabled, or holding leftovers from an older
 * build. Not one of those may throw into the editor, and not one of them may
 * replace the plan the user has open.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DRAFT_KEY,
  clearDraft,
  createDraftWriter,
  draftDiffers,
  readDraft,
  writeDraft,
  type DraftStorage,
} from './browser-draft';

/** A localStorage stand-in whose failures we can turn on. */
function memoryStorage(): DraftStorage & { map: Map<string, string>; fail: boolean } {
  const map = new Map<string, string>();
  return {
    map,
    fail: false,
    getItem(key: string): string | null {
      if (this.fail) throw new Error('storage disabled');
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (this.fail) {
        const error = new Error('quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(key, value);
    },
    removeItem(key: string): void {
      if (this.fail) throw new Error('storage disabled');
      map.delete(key);
    },
  };
}

describe('writeDraft / readDraft', () => {
  test('черновик записывается и читается как текст плана с временем', () => {
    const storage = memoryStorage();
    const written = writeDraft(storage, { text: '{"schemaVersion":1}', name: 'ОПС-1' }, 1_000);
    expect(written.ok).toBe(true);
    expect(storage.map.has(DRAFT_KEY)).toBe(true);

    const draft = readDraft(storage);
    expect(draft?.text).toBe('{"schemaVersion":1}');
    expect(draft?.name).toBe('ОПС-1');
    expect(draft?.savedAt).toBe(new Date(1_000).toISOString());
  });

  test('переполнение хранилища не бросает исключение, а возвращает причину', () => {
    const storage = memoryStorage();
    storage.fail = true;
    const written = writeDraft(storage, { text: '{}', name: 'план' }, 0);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.issues[0]?.code).toBe('DRAFT_NOT_SAVED');
    expect(written.issues[0]?.message).toContain('quota exceeded');
  });

  test('пустого черновика нет: readDraft возвращает null', () => {
    expect(readDraft(memoryStorage())).toBeNull();
  });

  test('битый черновик читается как «нет черновика»', () => {
    for (const junk of ['{', 'null', '[]', '{"text": 5}', '{"savedAt": "x"}', '"строка"']) {
      const storage = memoryStorage();
      storage.map.set(DRAFT_KEY, junk);
      expect(readDraft(storage)).toBeNull();
    }
  });

  test('недоступное хранилище читается как «нет черновика»', () => {
    const storage = memoryStorage();
    storage.fail = true;
    expect(readDraft(storage)).toBeNull();
  });

  test('clearDraft удаляет запись и молчит на недоступном хранилище', () => {
    const storage = memoryStorage();
    writeDraft(storage, { text: '{}', name: 'план' }, 0);
    clearDraft(storage);
    expect(storage.map.has(DRAFT_KEY)).toBe(false);

    storage.fail = true;
    expect(() => clearDraft(storage)).not.toThrow();
  });
});

describe('draftDiffers', () => {
  test('черновик, совпадающий с открытым планом, предлагать нечего', () => {
    expect(draftDiffers({ savedAt: 'x', name: 'п', text: '{"a":1}' }, '{"a":1}')).toBe(false);
  });

  test('отличающийся текст и неизвестное текущее состояние — есть что предложить', () => {
    expect(draftDiffers({ savedAt: 'x', name: 'п', text: '{"a":2}' }, '{"a":1}')).toBe(true);
    expect(draftDiffers({ savedAt: 'x', name: 'п', text: '{"a":2}' }, null)).toBe(true);
  });

  test('пустой черновик не предлагается', () => {
    expect(draftDiffers({ savedAt: 'x', name: 'п', text: '   ' }, null)).toBe(false);
  });
});

describe('createDraftWriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('частые правки дают одну запись — последнюю', () => {
    const storage = memoryStorage();
    const writer = createDraftWriter(storage, { delayMs: 500 });

    writer.schedule({ text: 'первый', name: 'план' });
    writer.schedule({ text: 'второй', name: 'план' });
    vi.advanceTimersByTime(499);
    expect(readDraft(storage)).toBeNull();

    writer.schedule({ text: 'третий', name: 'план' });
    vi.advanceTimersByTime(500);
    expect(readDraft(storage)?.text).toBe('третий');
  });

  test('план сериализуется один раз на серию правок, а не на каждую', () => {
    const storage = memoryStorage();
    const writer = createDraftWriter(storage, { delayMs: 500 });
    let encoded = 0;
    const produce = (text: string) => () => {
      encoded += 1;
      return { text, name: 'план' };
    };

    writer.schedule(produce('первый'));
    writer.schedule(produce('второй'));
    writer.schedule(produce('третий'));
    expect(encoded).toBe(0);

    vi.advanceTimersByTime(500);
    expect(encoded).toBe(1);
    expect(readDraft(storage)?.text).toBe('третий');
  });

  test('источник вернул null — записи нет', () => {
    const storage = memoryStorage();
    const writer = createDraftWriter(storage, { delayMs: 500 });
    writer.schedule(() => null);
    vi.advanceTimersByTime(500);
    expect(readDraft(storage)).toBeNull();
  });

  test('cancel отменяет запланированную запись', () => {
    const storage = memoryStorage();
    const writer = createDraftWriter(storage, { delayMs: 500 });
    writer.schedule({ text: 'план', name: 'план' });
    writer.cancel();
    vi.advanceTimersByTime(5_000);
    expect(readDraft(storage)).toBeNull();
  });

  test('ошибка записи уходит в обработчик, а не в исключение', () => {
    const storage = memoryStorage();
    const seen: string[] = [];
    const writer = createDraftWriter(storage, {
      delayMs: 100,
      onError: (message) => seen.push(message),
    });
    storage.fail = true;
    writer.schedule({ text: 'план', name: 'план' });
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('quota exceeded');
  });

  test('удачная запись сообщает время сохранения', () => {
    const storage = memoryStorage();
    const saved: string[] = [];
    const writer = createDraftWriter(storage, {
      delayMs: 100,
      now: () => 1_700_000_000_000,
      onSaved: (draft) => saved.push(draft.savedAt),
    });
    writer.schedule({ text: 'план', name: 'план' });
    vi.advanceTimersByTime(100);
    expect(saved).toEqual([new Date(1_700_000_000_000).toISOString()]);
  });
});
