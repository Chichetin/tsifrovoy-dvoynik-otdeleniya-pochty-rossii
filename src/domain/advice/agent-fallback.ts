/**
 * The agent without a model (D-236): a keyword router picks the same tools the
 * model would, and the answer text is written by code from their results.
 *
 * It is used when no provider is configured, the provider fails, or the
 * model's text does not pass the check — the person always gets the
 * calculation, marked «без LLM», never an empty panel.
 */

import type { Id, PlanDocument } from '../../contracts/model';
import { formatArea, formatShort } from '../number-format';
import type { AgentToolState } from './agent-tools';
import { fallbackExplanation } from './templates';

export type AgentToolCall = { name: string; args: Record<string, unknown> };
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
    return [{ name: 'find_place', args: { typeId, zoneId } }];
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

/** The answer text written by code from what the tools returned. */
export function composeFallbackText(state: AgentToolState, records: readonly AgentToolRecord[]): string {
  const parts: string[] = [];
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
    if (sentence !== null) parts.push(sentence);
  }
  if (recommendations.length > 3) parts.push(`Ещё рекомендаций: ${recommendations.length - 3} — в панелях справа.`);
  if (records.some((record) => record.name === 'check_equipment') && recommendations.every((entry) => entry.scenario !== 'equipment')) {
    parts.push('Нарушений правил комплектования нет.');
  }
  if (state.actions.some((action) => action.kind === 'apply-candidate')) {
    parts.push('Вариант показан на плане полупрозрачно — его можно применить кнопкой ниже.');
  }
  return parts.length === 0 ? 'Расчёт не нашёл, что ответить на этот вопрос. Уточните, о какой зоне или оборудовании речь.' : parts.join(' ');
}
