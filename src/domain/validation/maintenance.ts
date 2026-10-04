/**
 * #29: the date of the next maintenance (ТО) of an object.
 *
 * The date is an ordinary catalog attribute: a type declares the key in
 * `data/catalog/object-types.json`, and any object that holds a date under it
 * takes part. No type is named here. The dates in our files are synthetic,
 * the type's provenance says so in the card.
 *
 * "Today" is a parameter, not the clock: the check and its test must give the
 * same answer on any day. Dates are calendar days, so the difference is
 * counted on UTC midnights and a time zone never moves a day.
 */

import type { Equipment } from '../../contracts/model';

/** Attribute key of the next maintenance date, the same string as in the catalog. */
export const MAINTENANCE_DATE_KEY = 'nextMaintenanceDate';

/** Team rule, not a Post norm: warn this many days before the date. */
export const MAINTENANCE_WARNING_DAYS = 14;

export type MaintenanceStatus =
  | { kind: 'overdue'; date: string; days: number }
  | { kind: 'due-soon'; date: string; days: number }
  | { kind: 'invalid'; text: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** «2026-10-18» or «18.10.2026» → UTC midnight in ms; anything else → null. */
export function parseDay(text: string): number | null {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed);
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(trimmed);
  const parts = iso !== null ? [iso[1], iso[2], iso[3]] : ru !== null ? [ru[3], ru[2], ru[1]] : null;
  if (parts === null) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  // 31.02 rolls over to March in Date.UTC: such a day does not exist.
  const check = new Date(time);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return time;
}

/** Today as «YYYY-MM-DD» by the local clock: the default of the check. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** «18.10.2026»: the way the interface writes a day. */
export function formatDay(time: number): string {
  const date = new Date(time);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

/**
 * `null` — no date, or the date is more than 14 days ahead. `days` of an
 * overdue object is how many days ago the date was; of a due one, how many
 * days are left (0 — today).
 */
export function maintenanceStatus(object: Equipment, today: string): MaintenanceStatus | null {
  const value = object.attributes[MAINTENANCE_DATE_KEY];
  if (typeof value !== 'string' || value.trim() === '') return null;
  const due = parseDay(value);
  if (due === null) return { kind: 'invalid', text: value.trim() };
  const now = parseDay(today);
  if (now === null) return null;
  const days = Math.round((due - now) / DAY_MS);
  if (days < 0) return { kind: 'overdue', date: formatDay(due), days: -days };
  if (days <= MAINTENANCE_WARNING_DAYS) return { kind: 'due-soon', date: formatDay(due), days };
  return null;
}
