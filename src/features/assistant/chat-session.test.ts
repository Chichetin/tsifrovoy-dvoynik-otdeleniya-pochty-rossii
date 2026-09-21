import { describe, expect, test } from 'vitest';
import type { ChatTurn } from '../../contracts/advice-chat';
import {
  MAX_CHAT_CONTEXT_CHARS,
  MAX_CHAT_TURNS,
  appendTurn,
  clearChatSession,
  readChatSession,
  writeChatSession,
} from './chat-session';

function turn(id: string, preference = 'к входу'): ChatTurn {
  return {
    id,
    revision: 0,
    intent: {
      kind: 'request',
      request: { scenario: 'place', typeId: 'ot_workplace', zoneId: null },
      preference,
    },
    selection: null,
    refs: [],
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('chat session', () => {
  test('retains only the newest six normalized turns within the context budget', () => {
    const seven = Array.from({ length: 7 }, (_, index) => turn(`q${index}`));

    const retained = appendTurn([], seven);

    expect(MAX_CHAT_TURNS).toBe(6);
    expect(retained).toHaveLength(6);
    expect(retained.map((entry) => entry.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    expect(JSON.stringify(retained).length).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_CHARS);
  });

  test('drops older turns until a verbose context fits the serialized budget', () => {
    const retained = appendTurn([], [turn('old', 'x'.repeat(1_100)), turn('new', 'y'.repeat(1_100))]);

    expect(retained.map((entry) => entry.id)).toEqual(['new']);
    expect(JSON.stringify(retained).length).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_CHARS);
  });

  test('treats corrupt or denied session storage as an empty optional cache', () => {
    const corrupt = memoryStorage();
    corrupt.setItem('pochta.assistant.chat-session.v1', '{not json');
    const denied = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    } as unknown as Storage;

    expect(readChatSession(corrupt)).toEqual([]);
    expect(readChatSession(denied)).toEqual([]);
    expect(() => writeChatSession(denied, [turn('q1')])).not.toThrow();
    expect(() => clearChatSession(denied)).not.toThrow();
  });

  test('clears browser-only history when the document is replaced', () => {
    const storage = memoryStorage();
    writeChatSession(storage, [turn('q1')]);

    clearChatSession(storage);

    expect(readChatSession(storage)).toEqual([]);
  });
});
