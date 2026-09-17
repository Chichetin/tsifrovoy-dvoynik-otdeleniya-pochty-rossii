/**
 * IO03: the local draft — what the browser remembers between reloads.
 *
 * Only the text `encodePlan` produced is stored, never the canvas session: a
 * restored draft is a plan file that happens to live in localStorage, so it
 * opens through the same codec as a file from disk and cannot smuggle in a
 * state the editor would not otherwise accept.
 *
 * Storage is the least reliable thing a page touches — it can be full, turned
 * off by policy, or hold leftovers from an older build. Every call here answers
 * with a value instead of throwing: a draft that cannot be read is simply "no
 * draft", and a draft that cannot be written is reported, not swallowed. The
 * document the user has open is never touched by this module; restoring is a
 * decision the user makes.
 *
 * This is not a save to disk and never claims to be — the browser can only
 * offer a download, which is what the "Сохранить" button does.
 */

import type { Issue, Result } from '../contracts/model';

/** The one key this build owns; the suffix changes when the payload changes. */
export const DRAFT_KEY = 'ops-twin.draft.v1';

/** How long the editor stays quiet before writing a draft. */
export const DRAFT_DEBOUNCE_MS = 700;

/** Codes owned by this module. */
export const DRAFT_ISSUE_CODES = {
  /** The draft could not be written: quota, private mode, disabled storage. */
  DRAFT_NOT_SAVED: 'DRAFT_NOT_SAVED',
} as const;

/** The slice of `localStorage` used here, so tests can pass their own. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What a draft carries: the plan text plus enough to describe it to the user. */
export type PlanDraft = { savedAt: string; name: string; text: string };

/** The plan text to remember; the timestamp is added on write. */
export type DraftInput = { text: string; name: string };

/**
 * What to write, or how to produce it. The lazy form is what the editor uses:
 * the plan is serialised once, when the writing actually happens, not on every
 * pointer move that led to it. Returning `null` cancels the write.
 */
export type DraftSource = DraftInput | (() => DraftInput | null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Writes a draft. A storage failure comes back as issues, never as a throw. */
export function writeDraft(
  storage: DraftStorage,
  input: DraftInput,
  now: number,
): Result<PlanDraft> {
  const draft: PlanDraft = {
    savedAt: new Date(now).toISOString(),
    name: input.name,
    text: input.text,
  };
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    const issue: Issue = {
      code: DRAFT_ISSUE_CODES.DRAFT_NOT_SAVED,
      severity: 'warning',
      message: `Черновик не сохранён в браузере: ${message(error)}`,
      refs: [],
    };
    return { ok: false, issues: [issue] };
  }
  return { ok: true, value: draft };
}

/** Reads the draft. Anything unexpected in storage reads as "no draft". */
export function readDraft(storage: DraftStorage): PlanDraft | null {
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  const { savedAt, name, text } = payload as Record<string, unknown>;
  if (typeof savedAt !== 'string' || typeof name !== 'string' || typeof text !== 'string') {
    return null;
  }
  return { savedAt, name, text };
}

/** Forgets the draft. A storage that refuses to cooperate is not an error here. */
export function clearDraft(storage: DraftStorage): void {
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do: the draft is only ever offered, never applied by itself.
  }
}

/**
 * Is there anything to offer? A draft equal to what is already open — the empty
 * plan at start-up, usually — is not worth a question.
 */
export function draftDiffers(draft: PlanDraft, currentText: string | null): boolean {
  if (draft.text.trim() === '') return false;
  return draft.text !== currentText;
}

export type DraftWriterOptions = {
  delayMs?: number;
  now?: () => number;
  onSaved?: (draft: PlanDraft) => void;
  onError?: (message: string) => void;
};

export type DraftWriter = {
  /** Remembers the plan after the editing has paused for `delayMs`. */
  schedule: (source: DraftSource) => void;
  /** Drops a pending write: used on unmount and when the plan is replaced. */
  cancel: () => void;
};

/**
 * Debounced writer. Dragging an object fires a command per pointer move, and
 * every one of them would otherwise serialise the whole plan into storage.
 */
export function createDraftWriter(
  storage: DraftStorage,
  options: DraftWriterOptions = {},
): DraftWriter {
  const delayMs = options.delayMs ?? DRAFT_DEBOUNCE_MS;
  const now = options.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    cancel,
    schedule(source: DraftSource): void {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        const input = typeof source === 'function' ? source() : source;
        if (input === null) return;
        const written = writeDraft(storage, input, now());
        if (written.ok) {
          options.onSaved?.(written.value);
          return;
        }
        options.onError?.(written.issues.map((issue) => issue.message).join('; '));
      }, delayMs);
    },
  };
}
