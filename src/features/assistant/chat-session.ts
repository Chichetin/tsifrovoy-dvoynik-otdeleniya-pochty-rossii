import type { ChatTurn } from '../../contracts/advice-chat';

export const MAX_CHAT_TURNS = 6;
export const MAX_CHAT_CONTEXT_CHARS = 2_000;
export const CHAT_SESSION_KEY = 'pochta.assistant.chat-session.v1';

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;

function isTurn(value: unknown): value is ChatTurn {
  if (typeof value !== 'object' || value === null) return false;
  const turn = value as Partial<ChatTurn>;
  return (
    typeof turn.id === 'string' &&
    turn.id.length > 0 &&
    typeof turn.revision === 'number' &&
    Number.isInteger(turn.revision) &&
    turn.revision >= 0 &&
    typeof turn.intent === 'object' &&
    turn.intent !== null &&
    Array.isArray(turn.refs) &&
    (turn.selection === null || (typeof turn.selection === 'object' && Array.isArray(turn.selection.selections)))
  );
}

/**
 * Retains the newest confirmed exchanges only. The server independently
 * enforces the same boundary, so a browser cache can never grow its prompt.
 */
export function appendTurn(previous: readonly ChatTurn[], next: readonly ChatTurn[]): ChatTurn[] {
  const retained = [...previous, ...next].filter(isTurn).slice(-MAX_CHAT_TURNS);
  while (retained.length > 0 && JSON.stringify(retained).length > MAX_CHAT_CONTEXT_CHARS) retained.shift();
  return retained;
}

/** Reads an optional browser cache; privacy settings must not break the panel. */
export function readChatSession(storage: SessionStorageLike): ChatTurn[] {
  try {
    const raw = storage?.getItem(CHAT_SESSION_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isTurn)) return [];
    return appendTurn([], parsed);
  } catch {
    return [];
  }
}

/** Writes only the compact normalized history, never a plan or rendered answer. */
export function writeChatSession(storage: SessionStorageLike, turns: readonly ChatTurn[]): void {
  try {
    storage?.setItem(CHAT_SESSION_KEY, JSON.stringify(appendTurn([], turns)));
  } catch {
    // sessionStorage can be denied in private or embedded browser contexts.
  }
}

/** A replacement document starts a new conversation, even if its id is reused. */
export function clearChatSession(storage: SessionStorageLike): void {
  try {
    storage?.removeItem(CHAT_SESSION_KEY);
  } catch {
    // The cache is optional, so failed cleanup remains harmless.
  }
}
