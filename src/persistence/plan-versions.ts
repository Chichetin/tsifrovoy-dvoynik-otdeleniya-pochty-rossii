/**
 * #110: named versions of the plan — states the user marks («до перепланировки»,
 * «вариант 2») and opens again later, after a reload too.
 *
 * A version is the same text `encodePlan` writes to a file, like the draft
 * (`browser-draft.ts`): it opens through the same codec and cannot carry a
 * state a file could not. The file format does not change; versions live in
 * the browser only, next to the draft, and are not a save to disk.
 *
 * Storage can be full or switched off. Reads answer «no versions» instead of
 * throwing; a write that fails comes back as an issue and leaves the stored
 * list as it was.
 */

import type { Issue, Result } from '../contracts/model';

/** The one key this build owns; the suffix changes when the payload changes. */
export const VERSIONS_KEY = 'ops-twin.versions.v1';

/** Old versions are dropped past this count: localStorage holds about 5 MB. */
export const VERSIONS_LIMIT = 20;

export const VERSION_ISSUE_CODES = {
  /** The list could not be written: quota, private mode, disabled storage. */
  VERSION_NOT_SAVED: 'VERSION_NOT_SAVED',
  /** The label is empty after trimming. */
  VERSION_LABEL_EMPTY: 'VERSION_LABEL_EMPTY',
} as const;

export type VersionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** One named state of the plan; `text` is a plan file. */
export type PlanVersion = { id: string; label: string; savedAt: string; name: string; text: string };

/** What to remember; the id and the timestamp are added on write. */
export type VersionInput = { label: string; name: string; text: string };

function isVersion(value: unknown): value is PlanVersion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { id, label, savedAt, name, text } = value as Record<string, unknown>;
  return [id, label, savedAt, name, text].every((field) => typeof field === 'string');
}

/** Stored versions, newest first. Anything unreadable reads as «no versions». */
export function readVersions(storage: VersionStorage): PlanVersion[] {
  let raw: string | null;
  try {
    raw = storage.getItem(VERSIONS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return Array.isArray(payload) ? payload.filter(isVersion) : [];
}

function writeVersions(storage: VersionStorage, versions: PlanVersion[]): Result<PlanVersion[]> {
  try {
    storage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  } catch (error) {
    const issue: Issue = {
      code: VERSION_ISSUE_CODES.VERSION_NOT_SAVED,
      severity: 'warning',
      message: `Версии не записаны в браузер: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
    };
    return { ok: false, issues: [issue] };
  }
  return { ok: true, value: versions };
}

/** Adds a version on top of the list; the oldest past `VERSIONS_LIMIT` is dropped. */
export function addVersion(
  storage: VersionStorage,
  input: VersionInput,
  now: number,
): Result<PlanVersion[]> {
  const label = input.label.trim();
  if (label === '') {
    const issue: Issue = {
      code: VERSION_ISSUE_CODES.VERSION_LABEL_EMPTY,
      severity: 'error',
      message: 'Введите название версии.',
      refs: [],
    };
    return { ok: false, issues: [issue] };
  }
  const versions = readVersions(storage);
  // Two saves within one millisecond still get different ids.
  let stamp = now;
  while (versions.some((version) => version.id === `v${stamp}`)) stamp += 1;
  const version: PlanVersion = {
    id: `v${stamp}`,
    label,
    savedAt: new Date(now).toISOString(),
    name: input.name,
    text: input.text,
  };
  return writeVersions(storage, [version, ...versions].slice(0, VERSIONS_LIMIT));
}

/** Removes one version; an unknown id leaves the list as it is. */
export function removeVersion(storage: VersionStorage, id: string): Result<PlanVersion[]> {
  return writeVersions(storage, readVersions(storage).filter((version) => version.id !== id));
}
