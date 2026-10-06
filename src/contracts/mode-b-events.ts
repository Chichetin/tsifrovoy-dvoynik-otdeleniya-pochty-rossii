/**
 * Contracts v1: window events of mode B «Предложить место» (#179, D-379).
 * The entry points («Свойства», the object menu, «Библиотека») and the plan
 * ghost live in other features than the assistant and cannot import it
 * (docs/project-structure.md). They talk through these two window events.
 * Event names and `detail` types live only here; senders use `dispatch…`,
 * listeners read `detail` with `read…` and ignore anything of a wrong shape.
 */

import type { Equipment, Id, Point } from './model';

/** Request for place options. `detail`: `PlaceTarget`. Listener: the assistant session. */
export const SUGGEST_PLACE_EVENT = 'ops-twin:suggest-place';
/** The chosen option for the plan. `detail`: `SuggestionGhost` or null. Listener: equipment placement ghost. */
export const SUGGESTION_GHOST_EVENT = 'ops-twin:suggestion-ghost';

/** A standing object to move or a library type to add. */
export type PlaceTarget = { objectId: Id } | { typeId: Id };

/** What the plan draws: the outline where the object would stand, an arrow from where it stands now (null for a new object). */
export type SuggestionGhost = { from: Point | null; to: Equipment; label: string };

export function dispatchSuggestPlace(target: PlaceTarget): void {
  window.dispatchEvent(new CustomEvent<PlaceTarget>(SUGGEST_PLACE_EVENT, { detail: target }));
}

/** null clears the ghost. */
export function dispatchSuggestionGhost(ghost: SuggestionGhost | null): void {
  window.dispatchEvent(new CustomEvent<SuggestionGhost | null>(SUGGESTION_GHOST_EVENT, { detail: ghost }));
}

/** An event's `detail` as a target; a wrong shape or an empty id gives null. */
export function readPlaceTarget(detail: unknown): PlaceTarget | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const record = detail as Record<string, unknown>;
  if (typeof record.objectId === 'string' && record.objectId !== '') return { objectId: record.objectId };
  if (typeof record.typeId === 'string' && record.typeId !== '') return { typeId: record.typeId };
  return null;
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

/**
 * An event's `detail` as a ghost; null or a wrong shape gives null (no ghost).
 * `to` needs `position` and `size_m`; a wrong `from` becomes null, a wrong `label` becomes ''.
 */
export function readSuggestionGhost(detail: unknown): SuggestionGhost | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { to, from, label } = detail as Record<string, unknown>;
  if (typeof to !== 'object' || to === null) return null;
  const object = to as Partial<Equipment>;
  if (!isPoint(object.position) || !isPoint(object.size_m)) return null;
  return { to: to as Equipment, from: isPoint(from) ? from : null, label: typeof label === 'string' ? label : '' };
}
