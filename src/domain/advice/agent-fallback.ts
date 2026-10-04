/**
 * The agent without a model (D-258): a keyword router picks the same tools the
 * model would, and the answer text is written by code from their results.
 *
 * It is used when no provider is configured, the provider fails, or the
 * model's text does not pass the check — the person always gets the
 * calculation, marked «без LLM», never an empty panel.
 */

import type { Recommendation } from '../../contracts/advice';
import { AGENT_LIMITS, type AgentEdit } from '../../contracts/advice-chat';
import type { CountRule, Id, PlanDocument, Rule } from '../../contracts/model';
import { countInZoneScope } from '../inventory';
import { formatArea, formatShort } from '../number-format';
import type { AgentToolState } from './agent-tools';
import { cameraCandidateEffect } from './camera-placement';
import { fallbackExplanation } from './templates';

/**
 * `note` — what the router assumed or found that the question did not say; it goes into the answer.
 * `guessedZone` — the zone was chosen by the router, not named in the question: an empty result there widens the search.
 * `lead` — the note opens the answer (a refusal goes before everything else).
 */
export type AgentToolCall = { name: string; args: Record<string, unknown>; note?: string; guessedZone?: Id; lead?: boolean };
export type AgentToolRecord = { name: string; output: unknown };

const STOP_WORDS = new Set(['для', 'при', 'под', 'над', 'или', 'без', 'как', 'где', 'что', 'это', 'весь']);

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
    const { score, all } = labelScore(type.label, queryWords);
    // #34: a label whose stems are shorter than the threshold («Весы» → «вес»)
    // counts only for a near form of each word, not for any word starting so.
    const near = all && words(type.label).every((word) =>
      queryWords.some((query) => query.startsWith(stem(word)) && query.length <= word.length + 1));
    if ((score >= 4 || near) && (best === null || score > best.score)) best = { id: type.id, score };
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

function rulesFor(plan: PlanDocument, typeId: Id): Rule[] {
  return plan.catalog.rules.filter((rule) => rule.objectTypeId === typeId);
}

function countRulesFor(plan: PlanDocument, typeId: Id): CountRule[] {
  return rulesFor(plan, typeId).filter((rule): rule is CountRule => rule.kind === 'count');
}

/**
 * «name» (id): the chat UI (`AgentChat`) turns this exact shape into a single
 * button labelled with the name, dropping the id from what is shown — one
 * place decides what a person calls `z_storage`, this module only has to
 * write the shape consistently (D-320).
 */
function zoneTitle(plan: PlanDocument, zoneId: Id): string {
  return `«${plan.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId}» (${zoneId})`;
}

function typeTitle(plan: PlanDocument, typeId: Id): string {
  return `«${plan.catalog.objectTypes.find((type) => type.id === typeId)?.label ?? typeId}»`;
}

/** «правило команды, не норматив» once: the rationale of a team rule often says «Правило команды» itself. */
function ruleSource(rule: Rule): string {
  if (rule.source === 'organizer-material') return `${rule.id}; ${sourceLabel(rule)}`;
  return /^правило команды/i.test(rule.rationale) ? `${rule.id}, ${sourceLabel(rule)}` : `${rule.id}; ${sourceLabel(rule)}`;
}

function sourceLabel(rule: Rule): string {
  if (rule.source === 'organizer-material') return 'материалы организаторов';
  return 'справочник проекта';
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

/** The zone and its ancestors; the guard keeps a mid-edit cycle from hanging it. */
function zoneChain(plan: PlanDocument, zoneId: Id): Id[] {
  const parents = new Map(plan.zones.map((zone) => [zone.id, zone.parentId]));
  const chain: Id[] = [];
  let current: Id | null = zoneId;
  while (current !== null && !chain.includes(current)) {
    chain.push(current);
    current = parents.get(current) ?? null;
  }
  return chain;
}

type MaxState = { rule: CountRule; zoneId: Id; count: number; max: number };

/**
 * Maximum rules a new object standing in `zoneId` would count against, where
 * the maximum is already reached (count = max) or exceeded (count > max). An
 * `inclusive` rule of an ancestor zone counts the object too.
 */
function maxStatesAt(plan: PlanDocument, typeId: Id, zoneId: Id | null): MaxState[] {
  if (zoneId === null) return [];
  const chain = zoneChain(plan, zoneId);
  const states: MaxState[] = [];
  for (const rule of countRulesFor(plan, typeId)) {
    if (rule.max === null) continue;
    for (const zone of plan.zones) {
      if (zone.typeId !== rule.zoneTypeId) continue;
      if (rule.scope === 'direct' ? zone.id !== zoneId : !chain.includes(zone.id)) continue;
      const count = countInZoneScope(plan, typeId, zone.id, rule.scope);
      if (count >= rule.max) states.push({ rule, zoneId: zone.id, count, max: rule.max });
    }
  }
  return states;
}

function ruleZoneTitle(plan: PlanDocument, state: MaxState): string {
  return `${zoneTitle(plan, state.zoneId)}${state.rule.scope === 'inclusive' ? ' вместе с вложенными' : ''}`;
}

/**
 * One more object where the maximum is already exceeded is not offered at all:
 * the answer opens with the refusal, and check_equipment of the rule's zone
 * lists the counted objects and the excess — to be removed first.
 */
function refusalCalls(plan: PlanDocument, typeId: Id, zoneId: Id, exceeded: readonly MaxState[], guessed: boolean): AgentToolCall[] {
  const rules = exceeded.map((state) => `в зоне ${ruleZoneTitle(plan, state)} уже превышен максимум (${ruleSource(state.rule)})`);
  const note =
    `Ставить ещё одно ${typeTitle(plan, typeId)} в зону ${zoneTitle(plan, zoneId)}${guessed ? ' (зона в вопросе не названа — взята та, где такие объекты уже стоят)' : ''} не рекомендуется: ` +
    `${rules.join('; ')}. Сначала уберите лишнее — учтённые объекты перечислены ниже.`;
  const zones = [...new Set(exceeded.map((state) => state.zoneId))];
  return zones.map((ruleZone, index) => ({
    name: 'check_equipment',
    args: { zoneId: ruleZone },
    ...(index === 0 ? { note, lead: true } : {}),
  }));
}

/** Rules without a zone (distance to the entrance): named, with whether the search keeps to them. */
function zonelessRuleNotes(plan: PlanDocument, typeId: Id): string[] {
  return rulesFor(plan, typeId)
    .filter((rule) => rule.kind === 'distance-to-entrance')
    .map((rule) => {
      const entrance = rule.entranceId === null ? 'ближайшего входа' : `входа ${rule.entranceId}`;
      const search = rule.source === 'organizer-material' ? 'поиск места его соблюдает' : 'поиск места этим правилом не ограничен';
      return `Правило ${rule.id} (${sourceLabel(rule)}) — не дальше ${String(rule.maxDistance_m).replace('.', ',')} м от ${entrance} — зону не задаёт; ${search}.`;
    });
}

function placeCall(plan: PlanDocument, typeId: Id, zoneId: Id | null): AgentToolCall {
  const preferred = zoneId === null ? preferredZone(plan, typeId) : null;
  const zoneless = zonelessRuleNotes(plan, typeId);
  if (preferred === null) {
    const call: AgentToolCall = { name: 'find_place', args: { typeId, zoneId } };
    return zoneless.length === 0 ? call : { ...call, note: zoneless.join(' ') };
  }
  const rules =
    rulesFor(plan, typeId).length === 0
      ? 'правил для этого типа в справочнике нет'
      : countRulesFor(plan, typeId).length === 0
        ? 'правил комплектования по зонам для этого типа в справочнике нет'
        : 'правила с минимумом по зонам для этого типа в справочнике нет';
  const note = [
    `Зона в вопросе не названа — место ищется в зоне ${zoneTitle(plan, preferred)}: там уже стоят объекты типа ${typeTitle(plan, typeId)}, а ${rules}.`,
    ...zoneless,
  ].join(' ');
  return { name: 'find_place', args: { typeId, zoneId: preferred }, note, guessedZone: preferred };
}

/** The route for «where to put a <type>»: a refusal over an exceeded maximum, else the search. */
function placeRoute(plan: PlanDocument, typeId: Id, zoneId: Id | null): AgentToolCall[] {
  const target = zoneId ?? preferredZone(plan, typeId);
  const exceeded = maxStatesAt(plan, typeId, target).filter((state) => state.count > state.max);
  if (target !== null && exceeded.length > 0) return refusalCalls(plan, typeId, target, exceeded, zoneId === null);
  return [placeCall(plan, typeId, zoneId)];
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

/**
 * The search itself chose the zone (none was named or guessed): if the best
 * variant lands where a maximum is already exceeded, the variant is withdrawn
 * and the answer becomes the same refusal the router gives up front.
 */
export function limitCalls(state: AgentToolState): AgentToolCall[] {
  for (const recommendation of state.recommendations.values()) {
    const candidate = recommendation.candidates[0];
    if (recommendation.scenario !== 'place' || candidate === undefined || candidate.object.zoneId === null) continue;
    const exceeded = maxStatesAt(state.plan, candidate.object.typeId, candidate.object.zoneId).filter((entry) => entry.count > entry.max);
    if (exceeded.length === 0) continue;
    state.recommendations.delete(recommendation.id);
    return refusalCalls(state.plan, candidate.object.typeId, candidate.object.zoneId, exceeded, false);
  }
  return [];
}

/** The first sector layer type (cameras) of the catalog: its first object type and its layer in the plan. */
function cameraLayer(plan: PlanDocument): { typeId: Id; layerId: Id | null } | null {
  for (const type of plan.catalog.layerTypes) {
    if (type.representation.kind !== 'object-field') continue;
    const typeId = type.representation.objectTypeIds.find((id) => plan.catalog.objectTypes.some((entry) => entry.id === id));
    if (typeId === undefined) continue;
    return { typeId, layerId: plan.layers.find((layer) => layer.typeId === type.id)?.id ?? null };
  }
  return null;
}

/** Blind spots, what cameras see, where to put a camera — phrases, not word stems. */
const CAMERA_COVERAGE =
  /слеп[а-я]* (пятн|зон|участ|мест)|не вид[а-я]* камер|камер[а-я]* не вид|покрыти[а-я]* (камер|видеонаблюд|обзор)|видеонаблюдени|(постав|повес|добав|размест|установ)[а-я]* (ещ[её] )?(одн[а-я]* |нов[а-я]* )?камер/;
/** «Камера хранения» — a storage room. */
const STORAGE_ROOM = /камер[а-я]* хранени/;

/** #122: a request to lay a zone out anew. */
const LAYOUT_VERB = /(?:^|[^а-я])(разложи|расставь|переставь|раскладк)/;

/** #126: an imperative verb makes a clause an edit; «где поставить» stays a question about a place. */
const EDIT_VERB = /(?:^|[^а-я])(раздвинь|сдвинь|передвинь|подвинь|перемести|поверни|разверни|удали|убери|добавь|поставь)(?:[^а-я]|$)/;
const DIRECTIONS: Record<string, [number, number]> = { влево: [-1, 0], вправо: [1, 0], вверх: [0, 1], вниз: [0, -1] };

/** The label that shares the longest word starts with the clause: «окно» finds «Кассовое окно». */
function looseMatch<T extends { id: Id }>(entries: readonly T[], label: (entry: T) => string, clauseWords: readonly string[]): Id | null {
  let best: { id: Id; score: number } | null = null;
  for (const entry of entries) {
    const labelWords = words(label(entry));
    const score = clauseWords.map(stem).filter((part) => labelWords.some((word) => word.startsWith(part))).reduce((sum, part) => sum + part.length, 0);
    if (score > 0 && (best === null || score > best.score)) best = { id: entry.id, score };
  }
  return best?.id ?? null;
}

/** One clause of an edit request, as edits; an empty list when the clause is not understood. */
function clauseEdits(plan: PlanDocument, clause: string): AgentEdit[] {
  const verb = EDIT_VERB.exec(clause)?.[1];
  if (verb === undefined) return [];
  const number = /(\d+(?:[.,]\d+)?)\s*(?:м|°|град)/.exec(clause);
  const amount = number?.[1] === undefined ? null : Number(number[1].replace(',', '.'));
  const clauseWords = words(clause);
  const typeId = looseMatch(plan.catalog.objectTypes, (type) => type.label, clauseWords);
  const zoneId = looseMatch(plan.zones, (zone) => zone.name, clauseWords);
  const ids = [...clause.matchAll(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g)].map((match) => match[0]).filter((id) => plan.objects.some((object) => object.id === id));
  if (verb === 'добавь' || verb === 'поставь') return typeId === null ? [] : [{ op: 'add', typeId, zoneId, position_m: null }];
  // A type alone would delete every object of it: deletion takes ids only.
  if (verb === 'удали' || verb === 'убери') return ids.map((id) => ({ op: 'delete', id }));
  // Named ids, else the objects of the type in the named zone, else in the zone that has most of them.
  const ofType = plan.objects.filter((object) => object.typeId === typeId && (zoneId === null || object.zoneId === zoneId));
  const zones = [...new Set(ofType.map((object) => object.zoneId))];
  const group = zones.map((zone) => ofType.filter((object) => object.zoneId === zone)).sort((a, b) => b.length - a.length)[0] ?? [];
  const targets = ids.length > 0 ? plan.objects.filter((object) => ids.includes(object.id)) : group;
  if (verb === 'поверни' || verb === 'разверни') return targets.map((object) => ({ op: 'rotate', id: object.id, by_deg: amount ?? 90 }));
  const step = amount ?? 1;
  if (verb === 'раздвинь') {
    if (targets.length < 2) return [];
    const spread = (axis: 0 | 1): number => Math.max(...targets.map((o) => o.position[axis])) - Math.min(...targets.map((o) => o.position[axis]));
    const axis = spread(0) >= spread(1) ? 0 : 1;
    const sorted = [...targets].sort((a, b) => a.position[axis] - b.position[axis]);
    return sorted
      .map((object, index): AgentEdit => {
        const offset = (index - (sorted.length - 1) / 2) * step;
        return { op: 'move', id: object.id, dx_m: axis === 0 ? offset : 0, dy_m: axis === 1 ? offset : 0 };
      })
      .filter((edit) => edit.op === 'move' && (edit.dx_m !== 0 || edit.dy_m !== 0));
  }
  const direction = Object.entries(DIRECTIONS).find(([word]) => clause.includes(word))?.[1];
  if (direction === undefined) return [];
  return targets.map((object) => ({ op: 'move', id: object.id, dx_m: direction[0] * step, dy_m: direction[1] * step }));
}

/** #126: «раздвинь стеллажи на 1 м и добавь окно в зале» — clauses split on «и», commas, «затем». */
function editCalls(plan: PlanDocument, text: string): AgentToolCall[] {
  if (!EDIT_VERB.test(text)) return [];
  const edits = text.split(/,|;|\s(?:и|затем|потом)\s/).flatMap((clause) => clauseEdits(plan, clause)).slice(0, AGENT_LIMITS.maxEdits);
  if (edits.length === 0) return [];
  return [{
    name: 'propose_edits',
    args: { edits },
    note: 'Правку разобрал расчёт по ключевым словам: проверьте призраки на плане до применения.',
  }];
}

/** Which tools answer the question — the model-free counterpart of the agent loop. */
export function routeAgentQuery(plan: PlanDocument, query: string, hasBefore: boolean): AgentToolCall[] {
  const text = query.toLowerCase().replaceAll('ё', 'е');
  // #122: «разложи / расставь зону ожидания» — the layout of a named zone.
  if (LAYOUT_VERB.test(text)) {
    const zoneId = matchZone(plan, words(text));
    if (zoneId !== null) return [{ name: 'layout_zone', args: { zoneId }, note: 'Раскладку посчитал код: сравните варианты на плане.' }];
  }
  const edits = editCalls(plan, text);
  if (edits.length > 0) return edits;
  const queryWords = words(text);
  const cameras = cameraLayer(plan);
  const matched = matchType(plan, queryWords);
  // «Камера хранения» is a storage room, not a camera: the type match is dropped.
  const typeId = cameras !== null && matched === cameras.typeId && STORAGE_ROOM.test(text) ? null : matched;
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
  // #34: «что в зоне» asks about the zone itself. A zone name that shares a
  // word with a type («Зона ожидания» — bench) must not turn it into a search.
  if (zoneId !== null && /что (находится|стоит|есть)|состав/.test(text)) {
    return [{ name: 'zone_details', args: { zoneId } }, { name: 'show_on_plan', args: { ids: [zoneId] } }];
  }
  // #32: a question about blind spots or camera coverage is answered by
  // placing a camera to close the largest blind spot. Only whole phrases count
  // — «покрытие пола» or «стеллаж рядом с камерой» are about other things — and
  // such a phrase wins over a zone name that resembles another type's label
  // («камеру в зоне очереди» is not a queue terminal).
  if (cameras !== null && !STORAGE_ROOM.test(text) && CAMERA_COVERAGE.test(text)) {
    return placeRoute(plan, cameras.typeId, zoneId);
  }
  if (typeId !== null) return placeRoute(plan, typeId, zoneId);
  if (zoneId !== null) {
    return [{ name: 'zone_details', args: { zoneId } }, { name: 'show_on_plan', args: { ids: [zoneId] } }];
  }
  return [{ name: 'plan_overview', args: {} }];
}

/**
 * After the calls: the best placement variant is offered, as the model would.
 * A camera variant does not switch its layer on: showing a layer is a plan
 * change, and it would make «Применить» of this very answer stale. The answer
 * says in words where to look instead (`coverageSentence`).
 */
export function followUpCalls(state: AgentToolState): AgentToolCall[] {
  for (const recommendation of state.recommendations.values()) {
    const candidate = recommendation.candidates[0];
    if (recommendation.scenario === 'place' && candidate !== undefined) {
      return [{ name: 'suggest_candidate', args: { recommendationId: recommendation.id, candidateId: candidate.id } }];
    }
  }
  return [];
}

/** Where the sectors and hatched blind spots are — words, not an action that changes the plan. */
function layerHint(plan: PlanDocument, typeId: Id): string {
  const cameras = cameraLayer(plan);
  if (cameras === null || cameras.typeId !== typeId || cameras.layerId === null) return '';
  const layer = plan.layers.find((entry) => entry.id === cameras.layerId);
  if (layer === undefined) return '';
  return layer.visible
    ? `Секторы и заштрихованные слепые пятна — на слое «${layer.name}».`
    : `Секторы и слепые пятна покажет слой «${layer.name}» в панели «Слои» — включите его после того, как примените вариант.`;
}

/** «Было → стало» of a camera variant, in words; `null` for any other placement. */
function coverageSentence(state: AgentToolState, recommendation: Recommendation): string | null {
  const candidate = recommendation.candidates[0];
  if (recommendation.scenario !== 'place' || candidate === undefined) return null;
  const effect = cameraCandidateEffect(state.plan, candidate);
  if (effect === null || effect.before.total.percent === null || effect.after.total.percent === null) return null;
  // Tenths, and the change of the rounded shares: «29,8 → 72,1 (+42,3)» adds up on paper.
  const before = Math.round(effect.before.total.percent * 10) / 10;
  const after = Math.round(effect.after.total.percent * 10) / 10;
  const cameras = [...new Set(effect.before.zones.flatMap((zone) => zone.cameraIds))];
  const delta = Math.round((after - before) * 10) / 10;
  return [
    `Клиентские зоны видны камерами на ${formatShort(before)} %, с этим вариантом — на ${formatShort(after)} % (${delta > 0 ? '+' : ''}${formatShort(delta)} п. п.).`,
    cameras.length === 0 ? 'Сейчас клиентские зоны не видит ни одна камера.' : `Сейчас их видят камеры ${cameras.join(', ')}.`,
    layerHint(state.plan, candidate.object.typeId),
  ].filter((part) => part !== '').join(' ');
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
    .map((ref) => `«${state.names.nameOf(ref) ?? ref.id}» (${ref.id})`);
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
export function composeFallbackText(
  state: AgentToolState,
  records: readonly AgentToolRecord[],
  notes: readonly string[] = [],
  namedZones: readonly Id[] = [],
): string {
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
    // A note already named the zone the router chose — no need to repeat it.
    const zoneKnown = zoneId !== null && namedZones.includes(zoneId);
    const place = recommendation.scenario === 'place' && candidate !== undefined;
    const reached = place ? maxStatesAt(state.plan, candidate.object.typeId, zoneId).filter((entry) => entry.count === entry.max) : [];
    const paragraph = [
      details?.head,
      sentence,
      coverageSentence(state, recommendation),
      details?.tail,
      place && !zoneKnown ? `Место ${zoneLabel(state, zoneId)}.` : null,
      ...reached.map((entry) => `Этот вариант нарушит максимум (${ruleSource(entry.rule)}): в зоне ${ruleZoneTitle(state.plan, entry)} таких объектов уже предельное число.`),
    ].filter((part): part is string => typeof part === 'string' && part !== '');
    if (paragraph.length > 0) parts.push(paragraph.join(' '));
  }
  if (recommendations.length > 3) parts.push(`Ещё рекомендаций: ${recommendations.length - 3} — в панелях справа.`);
  if (records.some((record) => record.name === 'check_equipment') && recommendations.every((entry) => entry.scenario !== 'equipment')) {
    parts.push('Нарушений правил комплектования нет.');
  }
  for (const proposal of state.proposals) {
    const metric = (code: string, phase: string): number | undefined => proposal.facts.find((fact) => fact.metric === code && fact.phase === phase)?.value;
    // #122: a layout variant reads by its own numbers; the area does not change.
    if (proposal.title !== undefined) {
      const pair = (code: string, name: string): string => {
        const was = metric(code, 'before');
        const now = metric(code, 'after');
        return was === undefined || now === undefined ? '' : `${name}: ${formatShort(was, 2)} → ${formatShort(now, 2)} м.`;
      };
      parts.push([
        `${proposal.title}. Сдвинуто объектов: ${proposal.changes.length}.`,
        pair('layout.passage', 'Самый узкий проход'),
        pair('layout.entrance', 'Среднее расстояние до входа'),
        `Ошибок проверки: ${proposal.findings.errors.before} → ${proposal.findings.errors.after}.`,
      ].filter(Boolean).join(' '));
      continue;
    }
    const free = (phase: string): number | undefined => metric('area.free', phase);
    const before = free('before');
    const after = free('after');
    const { errors } = proposal.findings;
    parts.push([
      `Правки: принято ${proposal.changes.length}, отклонено ${proposal.rejected.length}.`,
      proposal.commands.length === 0 || before === undefined || after === undefined ? '' : `Свободная площадь: ${formatArea(before)} → ${formatArea(after)}. Ошибок проверки: ${errors.before} → ${errors.after}.`,
      proposal.commands.length === 0 ? 'План не изменится: ни одна правка не прошла проверку, причины — в списке ниже.' : 'Правки показаны на плане полупрозрачно. «Применить правки» — одной командой, отмена — Ctrl+Z.',
    ].filter(Boolean).join(' '));
  }
  if (state.actions.some((action) => action.kind === 'apply-candidate')) {
    parts.push('Вариант показан на плане полупрозрачно — его можно применить кнопкой ниже.');
  }
  return parts.length === 0 ? 'Расчёт не нашёл, что ответить на этот вопрос. Уточните, о какой зоне или оборудовании речь.' : parts.join('\n\n');
}

/**
 * «name» (id): the shape a structured recommendation still writes for its
 * assumptions and limitations (`index.ts`, `equipment.ts`) — text that is
 * printed as-is, without the chat's per-mention buttons (D-320). `AgentChat`
 * builds on the same pattern (its `.source`) instead of keeping a second
 * copy, so the two never drift apart (review of !318, #10).
 */
export const QUOTED_ID_PATTERN = /«([^»]{1,120})»\s*\(([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\)/gi;

/**
 * The sentence as a person reads it: the id that would let a click focus the
 * plan is dropped, the quoted name stays — for a card or a list that shows a
 * calculated sentence without offering that click itself (D-321).
 */
export function hideNamedIds(text: string): string {
  return text.replace(QUOTED_ID_PATTERN, '«$1»');
}
