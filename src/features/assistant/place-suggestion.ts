/**
 * #179, mode B «Предложить место»: the options the assistant shows for one
 * standing object (a move, #177 `findRelocations`) or for a library type (a
 * new object, `calculateAdvice` «place»). Every number is code; the short
 * reason is a template over the same numbers — no model is called here.
 *
 * Nothing here edits the plan. A move goes in as its own `object.put`, a new
 * object as `candidateObjectForInsert`: one command, one undo step.
 */

import type { Candidate, Fact } from '../../contracts/advice';
import type { Command } from '../../contracts/commands';
import type { Equipment, Id, PlanDocument, Point, Result } from '../../contracts/model';
import { calculateAdvice, placementZonePath } from '../../domain/advice';
import { findRelocations, type RelocationOption } from '../../domain/advice/relocation';
import { formatMeasure } from '../../domain/number-format';

/**
 * The entry points («Свойства», the object menu, «Библиотека») live in other
 * features and cannot import this module (docs/project-structure.md). They
 * fire this window event with `PlaceTarget` as `detail`; the assistant session
 * listens. The same name is written in each of them.
 */
export const SUGGEST_PLACE_EVENT = 'ops-twin:suggest-place';
/** The chosen option for the plan: `SuggestionGhost` or null as `detail`, read by `features/equipment/placement-ghost.ts`. */
export const SUGGESTION_GHOST_EVENT = 'ops-twin:suggestion-ghost';

export type PlaceTarget = { objectId: Id } | { typeId: Id };

/** What the plan draws: the outline where the object would stand, an arrow from where it stands now. */
export type SuggestionGhost = { from: Point | null; to: Equipment; label: string };

export type PlaceNumber = { label: string; before: string; after: string };

export type PlaceOption = {
  id: Id;
  /** move — the standing object goes there; add — a new object; keep — the plan stays as it is. */
  kind: 'move' | 'add' | 'keep';
  title: string;
  /** «зона «Зал → Окна»» or «вне зон» — names, ids are in `zoneIds`. */
  zone: string;
  zoneIds: Id[];
  /** Short reason, built from the numbers below. */
  reason: string;
  numbers: PlaceNumber[];
  /** Where the ghost stands; null for keep. */
  object: Equipment | null;
  /** move: the one command; add: built at «Подтвердить» from `candidate` with fresh ids. */
  command: Command | null;
  candidate: Candidate | null;
};

export type PlaceSubject = {
  kind: 'object' | 'type';
  id: Id;
  name: string;
  /** Where the standing object is now: the arrow starts here. Null for a new object. */
  from: Point | null;
  locked: boolean;
};

export type PlaceOptions = { subject: PlaceSubject; options: PlaceOption[] };

const m2 = (value: number): string => formatMeasure(value, 'м²');
const metres = (value: number): string => formatMeasure(value, 'м');
const count = (value: number): string => formatMeasure(value, 'шт.', 0);

function zoneText(names: string[]): string {
  return names.length === 0 ? 'вне зон' : `зона «${names.join(' → ')}»`;
}

function failure(message: string, objectId: Id | null): Result<never> {
  return { ok: false, issues: [{ code: 'PLACE_SUGGESTION', severity: 'error', message, refs: objectId === null ? [] : [{ kind: 'object', id: objectId }] }] };
}

function moveNumbers(plan: PlanDocument, option: RelocationOption): PlaceNumber[] {
  const zoneName = (id: Id): string => plan.zones.find((zone) => zone.id === id)?.name ?? id;
  const numbers: PlaceNumber[] = [];
  for (const effect of option.zoneEffects) {
    numbers.push({ label: `Свободно в «${zoneName(effect.zoneId)}»`, before: m2(effect.free_m2.before), after: m2(effect.free_m2.after) });
    numbers.push({ label: `Объектов в «${zoneName(effect.zoneId)}»`, before: count(effect.objects.before), after: count(effect.objects.after) });
  }
  if (option.coverage !== null && option.coverage.before !== null && option.coverage.after !== null) {
    numbers.push({ label: 'Покрытие клиентских зон камерами', before: formatMeasure(option.coverage.before, '%', 0), after: formatMeasure(option.coverage.after, '%', 0) });
  }
  return numbers;
}

function relocationOptions(plan: PlanDocument, objectId: Id): Result<PlaceOptions> {
  const object = plan.objects.find((entry) => entry.id === objectId);
  if (object === undefined) return failure('Объекта больше нет в плане.', objectId);
  const found = findRelocations(plan, { objectId, zoneId: null });
  if (!found.ok) return found;
  let moves = 0;
  const options = found.value.options.map((option): PlaceOption => {
    const zone = zoneText(option.zones.map((entry) => entry.name));
    const zoneIds = option.zones.map((entry) => entry.id);
    const numbers = moveNumbers(plan, option);
    if (option.command === null) {
      return {
        id: option.id, kind: 'keep', title: 'Оставить как есть', zone, zoneIds, numbers,
        reason: `Объект остаётся на месте, ${zone}. План не меняется.`,
        object: null, command: null, candidate: null,
      };
    }
    moves += 1;
    const travelled = option.facts.find((fact) => fact.metric === 'placement.distance' && fact.phase === 'delta')?.value ?? 0;
    const parts = [`Перенос на ${metres(travelled)}`];
    if (Number.isFinite(option.wallGap_m)) parts.push(`до стены ${metres(option.wallGap_m)}`);
    parts.push(option.warnings === 0 ? 'новых находок проверки нет' : `новых предупреждений: ${option.warnings}`);
    return {
      id: option.id, kind: 'move', title: `Вариант ${moves}`, zone, zoneIds, numbers,
      reason: `${parts.join('; ')}.`,
      object: option.object, command: option.command, candidate: null,
    };
  });
  return {
    ok: true,
    value: { subject: { kind: 'object', id: object.id, name: object.label, from: object.position, locked: object.locked === true }, options },
  };
}

/** `current`/`before` and `after` of one metric, as the candidate's facts give them. */
function pairOf(facts: Fact[], metric: Fact['metric']): { before: Fact; after: Fact } | null {
  const before = facts.find((fact) => fact.metric === metric && (fact.phase === 'current' || fact.phase === 'before'));
  const after = facts.find((fact) => fact.metric === metric && fact.phase === 'after');
  return before === undefined || after === undefined ? null : { before, after };
}

function insertOptions(plan: PlanDocument, typeId: Id): Result<PlaceOptions> {
  const type = plan.catalog.objectTypes.find((entry) => entry.id === typeId);
  if (type === undefined) return failure('Этого типа больше нет в справочнике плана.', null);
  const advice = calculateAdvice(plan, { scenario: 'place', typeId, zoneId: null });
  if (!advice.ok) return advice;
  const candidates = advice.value.flatMap((recommendation) => recommendation.candidates).slice(0, 3);
  const options: PlaceOption[] = candidates.map((candidate, index) => {
    const zoneIds = placementZonePath(plan, candidate.object);
    const zone = zoneText(zoneIds.map((id) => plan.zones.find((entry) => entry.id === id)?.name ?? id));
    const numbers: PlaceNumber[] = [];
    const free = pairOf(candidate.facts, 'area.free');
    if (free !== null) numbers.push({ label: 'Свободно в помещении', before: m2(free.before.value), after: m2(free.after.value) });
    const counted = pairOf(candidate.facts, 'equipment.count');
    if (counted !== null) numbers.push({ label: `Объектов «${type.label}»`, before: count(counted.before.value), after: count(counted.after.value) });
    return {
      id: candidate.id, kind: 'add', title: `Вариант ${index + 1}`, zone, zoneIds, numbers,
      reason: `Свободное место, ${zone}: план примет объект без новых ошибок проверки.`,
      object: candidate.object, command: null, candidate,
    };
  });
  options.push({
    id: `${typeId}.keep`, kind: 'keep', title: 'Не добавлять', zone: '', zoneIds: [], numbers: [],
    reason: 'План не меняется.', object: null, command: null, candidate: null,
  });
  return { ok: true, value: { subject: { kind: 'type', id: type.id, name: type.label, from: null, locked: false }, options } };
}

/** Up to three options and «оставить как есть» last. */
export function placeOptions(plan: PlanDocument, target: PlaceTarget): Result<PlaceOptions> {
  return 'objectId' in target ? relocationOptions(plan, target.objectId) : insertOptions(plan, target.typeId);
}

/** A window event's `detail` as a target; anything else is ignored. */
export function placeTargetOf(detail: unknown): PlaceTarget | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const record = detail as Record<string, unknown>;
  if (typeof record.objectId === 'string' && record.objectId !== '') return { objectId: record.objectId };
  if (typeof record.typeId === 'string' && record.typeId !== '') return { typeId: record.typeId };
  return null;
}
