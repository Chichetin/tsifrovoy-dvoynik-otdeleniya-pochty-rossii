/**
 * The agent without a model (D-258): a keyword router picks the same tools the
 * model would, and the answer text is written by code from their results.
 *
 * It is used when no provider is configured, the provider fails, or the
 * model's text does not pass the check — the person always gets the
 * calculation, marked «без LLM», never an empty panel.
 */

import type { Recommendation } from '../../contracts/advice';
import type { CountRule, Id, PlanDocument, Rule } from '../../contracts/model';
import { countInZoneScope } from '../inventory';
import { formatArea, formatShort } from '../number-format';
import type { AgentToolState } from './agent-tools';
import { fallbackExplanation } from './templates';

/**
 * `note` — what the router assumed or found that the question did not say; it goes into the answer.
 * `guessedZone` — the zone was chosen by the router, not named in the question: an empty result there widens the search.
 */
export type AgentToolCall = { name: string; args: Record<string, unknown>; note?: string; guessedZone?: Id };
export type AgentToolRecord = { name: string; output: unknown };

const STOP_WORDS = new Set(['для', 'при', 'под', 'над', 'или', 'без', 'как', 'где', 'что', 'это']);

function words(text: string): string[] {
  return text.toLowerCase().replaceAll('ё', 'е').split(/[^a-zа-я0-9]+/).filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/** A crude Russian stem: enough to match «окно» with «окна», «зал» with «зале». */
function stem(word: string): string {
  return word.slice(0, Math.max(3, word.length - 2));
}

/** Sum of stem lengths the label shares with the question — longer stems weigh more. */
function labelScore(label: string, queryWords: readonly string[]): { score: number; all: boolean } {
  const stems = words(label).map(stem);
  const hit = stems.filter((entry) => queryWords.some((word) => word.startsWith(entry)));
  return { score: hit.reduce((sum, entry) => sum + entry.length, 0), all: stems.length > 0 && hit.length === stems.length };
}

function matchType(plan: PlanDocument, queryWords: readonly string[]): Id | null {
  let best: { id: Id; score: number } | null = null;
  for (const type of plan.catalog.objectTypes) {
    const { score } = labelScore(type.label, queryWords);
    if (score >= 4 && (best === null || score > best.score)) best = { id: type.id, score };
  }
  return best?.id ?? null;
}

function matchZone(plan: PlanDocument, queryWords: readonly string[]): Id | null {
  let best: { id: Id; score: number } | null = null;
  for (const zone of plan.zones) {
    const { score, all } = labelScore(zone.name, queryWords);
    if (all && (best === null || score > best.score)) best = { id: zone.id, score };
  }
  return best?.id ?? null;
}

function countRulesFor(plan: PlanDocument, typeId: Id): CountRule[] {
  return plan.catalog.rules.filter((rule): rule is CountRule => rule.kind === 'count' && rule.objectTypeId === typeId);
}

function zoneTitle(plan: PlanDocument, zoneId: Id): string {
  return `«${plan.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId}» (${zoneId})`;
}

/** «правило команды, не норматив» once: the rationale of a team rule often says «Правило команды» itself. */
function ruleSource(rule: Rule): string {
  if (rule.source === 'organizer-material') return `${rule.id}; материалы организаторов`;
  return /^правило команды/i.test(rule.rationale) ? `${rule.id}, не норматив Почты России` : `${rule.id}; правило команды, не норматив Почты России`;
}

/**
 * A zone for a type the question gave no zone for. Only when no count rule
 * gives the type a minimum per zone (then the search is not narrowed at all):
 * the zone where most objects of the type already stand, first in plan order
 * on a tie. With a minimum the search already keeps to the rule's zones.
 */
function preferredZone(plan: PlanDocument, typeId: Id): Id | null {
  if (countRulesFor(plan, typeId).some((rule) => rule.min !== null)) return null;
  let best: { id: Id; count: number } | null = null;
  for (const zone of plan.zones) {
    const count = plan.objects.filter((object) => object.typeId === typeId && object.zoneId === zone.id).length;
    if (count > 0 && (best === null || count > best.count)) best = { id: zone.id, count };
  }
  return best?.id ?? null;
}

function placeCall(plan: PlanDocument, typeId: Id, zoneId: Id | null): AgentToolCall {
  const preferred = zoneId === null ? preferredZone(plan, typeId) : null;
  if (preferred === null) return { name: 'find_place', args: { typeId, zoneId } };
  const typeLabel = plan.catalog.objectTypes.find((type) => type.id === typeId)?.label ?? typeId;
  const rules = countRulesFor(plan, typeId).length === 0
    ? 'правил комплектования для этого типа в справочнике нет'
    : 'правила с минимумом по зонам для этого типа в справочнике нет';
  const note =
    `Зона в вопросе не названа — место ищется в зоне ${zoneTitle(plan, preferred)}: там уже стоят объекты типа «${typeLabel}», а ${rules}.`;
  return { name: 'find_place', args: { typeId, zoneId: preferred }, note, guessedZone: preferred };
}

/**
 * A new object against the type's maximum: where the rule is already reached
 * or exceeded, the answer says so instead of silently offering one more. An
 * exceeded rule also runs check_equipment for the zone, so the counts in the
 * answer come from the calculation.
 */
function maxRuleNotes(plan: PlanDocument, typeId: Id): { reached: string[]; exceeded: AgentToolCall[] } {
  const reached: string[] = [];
  const exceeded: AgentToolCall[] = [];
  for (const rule of countRulesFor(plan, typeId)) {
    if (rule.max === null) continue;
    const max = rule.max;
    for (const zone of plan.zones.filter((entry) => entry.typeId === rule.zoneTypeId)) {
      const count = countInZoneScope(plan, typeId, zone.id, rule.scope);
      if (count < max) continue;
      const where = `В зоне ${zoneTitle(plan, zone.id)}${rule.scope === 'inclusive' ? ' вместе с вложенными' : ''}`;
      if (count > max) {
        exceeded.push({
          name: 'check_equipment',
          args: { zoneId: zone.id },
          note: `${where} правило максимума ${rule.id} уже нарушено — объектов этого типа больше допустимого; вариант внутри этой зоны увеличит превышение.`,
        });
      } else {
        reached.push(`${where} уже достигнут максимум правила ${rule.id} (${ruleSource(rule)}); вариант внутри этой зоны его нарушит.`);
      }
    }
  }
  return { reached, exceeded };
}

/**
 * The router guessed the zone and found no place there: the search is repeated
 * over the whole plan, and the empty guess is dropped from the answer.
 */
export function widenCalls(state: AgentToolState, routed: readonly AgentToolCall[]): AgentToolCall[] {
  const guess = routed.find((call) => call.name === 'find_place' && call.guessedZone !== undefined);
  if (guess?.guessedZone === undefined) return [];
  const places = [...state.recommendations.values()].filter((entry) => entry.scenario === 'place');
  if (places.some((entry) => entry.candidates.length > 0)) return [];
  for (const entry of places) state.recommendations.delete(entry.id);
  return [{
    name: 'find_place',
    args: { typeId: guess.args.typeId, zoneId: null },
    note: `В зоне ${zoneTitle(state.plan, guess.guessedZone)} места нет — вариант по всему плану.`,
  }];
}

/** Which tools answer the question — the model-free counterpart of the agent loop. */
export function routeAgentQuery(plan: PlanDocument, query: string, hasBefore: boolean): AgentToolCall[] {
  const text = query.toLowerCase().replaceAll('ё', 'е');
  const queryWords = words(text);
  const typeId = matchType(plan, queryWords);
  const zoneId = matchZone(plan, queryWords);

  if (hasBefore && /измен|было|стало|сравн|эффект|разниц|до и после/.test(text)) {
    return [{ name: 'compare_with_original', args: {} }, { name: 'open_panel', args: { panel: 'metrics' } }];
  }
  if (/ошибк|проверк|пересек|пересеч|наруш|неправил|конфликт/.test(text)) {
    return [{ name: 'validate_plan', args: {} }, { name: 'open_panel', args: { panel: 'validation' } }];
  }
  if (/не хват|нехват|лишн|комплект|недостат|избыт|чего нет|отсутств|сколько нужно/.test(text)) {
    return [{ name: 'check_equipment', args: { zoneId } }];
  }
  if (typeId !== null) {
    const place = placeCall(plan, typeId, zoneId);
    const limits = maxRuleNotes(plan, typeId);
    const note = [place.note, ...limits.reached].filter(Boolean).join(' ');
    return [note === '' ? place : { ...place, note }, ...limits.exceeded];
  }
  if (zoneId !== null) {
    return [{ name: 'zone_details', args: { zoneId } }, { name: 'show_on_plan', args: { ids: [zoneId] } }];
  }
  return [{ name: 'plan_overview', args: {} }];
}

/** After the calls: the best placement variant is offered, as the model would. */
export function followUpCalls(state: AgentToolState): AgentToolCall[] {
  for (const recommendation of state.recommendations.values()) {
    const candidate = recommendation.candidates[0];
    if (recommendation.scenario === 'place' && candidate !== undefined) {
      return [{ name: 'suggest_candidate', args: { recommendationId: recommendation.id, candidateId: candidate.id } }];
    }
  }
  return [];
}

type Overview = {
  room?: { total_m2?: number; occupied_m2?: number; free_m2?: number };
  zones?: unknown[];
  objectsTotal?: number;
  validation?: { errors: number; warnings: number };
};

type ZoneView = { name: string; total_m2: number | null; free_m2: number | null; objectsCount: number };
type ValidationView = { errors: number; warnings: number; issues: { message: string }[] };

function overviewText(output: Overview): string | null {
  const room = output.room;
  if (room?.total_m2 === undefined || room.free_m2 === undefined || room.occupied_m2 === undefined) return null;
  const validation = output.validation;
  return [
    `Помещение ${formatArea(room.total_m2)}: занято ${formatArea(room.occupied_m2)}, свободно ${formatArea(room.free_m2)}.`,
    `Зон — ${output.zones?.length ?? 0}, объектов — ${output.objectsTotal ?? 0}.`,
    validation === undefined ? '' : `Проверка: ошибок ${validation.errors}, предупреждений ${validation.warnings}.`,
  ].filter(Boolean).join(' ');
}

function zoneText(output: ZoneView): string {
  const area = output.total_m2 === null ? '' : ` — ${formatArea(output.total_m2)}, свободно ${formatArea(output.free_m2 ?? 0)}`;
  return `Зона «${output.name}»${area}, объектов: ${output.objectsCount}.`;
}

function validationText(output: ValidationView): string {
  if (output.errors + output.warnings === 0) return 'Проверка плана не нашла ошибок и предупреждений.';
  const first = output.issues.slice(0, 3).map((issue) => issue.message).join(' ');
  return `Проверка нашла ошибок: ${output.errors}, предупреждений: ${output.warnings}. ${first}`;
}

function zoneLabel(state: AgentToolState, zoneId: Id | null): string {
  if (zoneId === null) return 'вне зон';
  return `в зоне «${state.names.zoneName(zoneId) ?? zoneId}» (${zoneId})`;
}

/** Longer lists name the first few: the rest are one click away in the inventory. */
const LISTED_OBJECTS = 5;

/** Type, zone, counted objects and whose rule it is — all from the recommendation and the catalog. */
function equipmentDetails(state: AgentToolState, recommendation: Recommendation): { head: string; tail: string } {
  const rule = state.plan.catalog.rules.find((entry) => entry.id === recommendation.ruleIds[0]);
  const zoneId = recommendation.refs.find((ref) => ref.kind === 'zone')?.id ?? null;
  const objects = recommendation.refs
    .filter((ref) => ref.kind === 'object')
    .map((ref) => `${ref.id} «${state.names.nameOf(ref) ?? ref.id}»`);
  const shown = objects.length <= LISTED_OBJECTS ? objects.join(', ') : `${objects.slice(0, LISTED_OBJECTS).join(', ')} и другие, всего ${objects.length}`;
  const typeId = rule?.kind === 'count' ? rule.objectTypeId : null;
  const typeLabel = typeId === null ? null : (state.names.objectTypeLabel(typeId) ?? typeId);
  return {
    head: `${typeLabel === null ? 'Оборудование' : `«${typeLabel}»`} ${zoneLabel(state, zoneId)}:`,
    tail: [
      objects.length === 0 ? 'Таких объектов в зоне нет.' : `Учтены: ${shown}.`,
      rule === undefined ? '' : `${rule.rationale.replace(/\.$/, '')} (${ruleSource(rule)}).`,
    ].filter(Boolean).join(' '),
  };
}

/** The answer text written by code from what the tools returned. */
export function composeFallbackText(state: AgentToolState, records: readonly AgentToolRecord[], notes: readonly string[] = []): string {
  // One paragraph per note, tool and recommendation: the chat splits the text on blank lines.
  const parts: string[] = [...notes];
  for (const record of records) {
    const output = record.output as Record<string, unknown> | null;
    if (output === null || typeof output !== 'object' || 'error' in output) continue;
    if (record.name === 'plan_overview') {
      const text = overviewText(output as Overview);
      if (text !== null) parts.push(text);
    }
    if (record.name === 'zone_details') parts.push(zoneText(output as unknown as ZoneView));
    if (record.name === 'validate_plan') parts.push(validationText(output as unknown as ValidationView));
    if (record.name === 'list_objects') parts.push(`Найдено объектов: ${formatShort(Number(output.count ?? 0), 0)}.`);
  }

  const recommendations = [...state.recommendations.values()];
  for (const recommendation of recommendations.slice(0, 3)) {
    const sentence = fallbackExplanation(recommendation);
    const details = recommendation.scenario === 'equipment' ? equipmentDetails(state, recommendation) : null;
    const candidate = recommendation.candidates[0];
    const zoneId = candidate?.object.zoneId ?? null;
    // The note already named the zone the router chose — no need to repeat it.
    const zoneKnown = zoneId !== null && notes.some((note) => note.includes(`место ищется в зоне «${state.names.zoneName(zoneId) ?? zoneId}» (${zoneId})`));
    const paragraph = [
      details?.head,
      sentence,
      details?.tail,
      recommendation.scenario === 'place' && candidate !== undefined && !zoneKnown ? `Место ${zoneLabel(state, zoneId)}.` : null,
    ].filter((part): part is string => typeof part === 'string' && part !== '');
    if (paragraph.length > 0) parts.push(paragraph.join(' '));
  }
  if (recommendations.length > 3) parts.push(`Ещё рекомендаций: ${recommendations.length - 3} — в панелях справа.`);
  if (records.some((record) => record.name === 'check_equipment') && recommendations.every((entry) => entry.scenario !== 'equipment')) {
    parts.push('Нарушений правил комплектования нет.');
  }
  if (state.actions.some((action) => action.kind === 'apply-candidate')) {
    parts.push('Вариант показан на плане полупрозрачно — его можно применить кнопкой ниже.');
  }
  return parts.length === 0 ? 'Расчёт не нашёл, что ответить на этот вопрос. Уточните, о какой зоне или оборудовании речь.' : parts.join('\n\n');
}
