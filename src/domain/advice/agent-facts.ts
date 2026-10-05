/**
 * Issue #3: the model chooses a fact, never its metric, subject, unit or value.
 * This internal catalog is built from successful read tools and calculated
 * recommendations. User questions and conversation history are not evidence.
 */
import { z } from 'zod';
import type { Candidate, Fact, FactPhase, FactUnit, MetricCode, Recommendation } from '../../contracts/advice';
import type { Id, Ref } from '../../contracts/model';
import { relocationParagraphs, type AgentToolRecord } from './agent-fallback';
import type { AgentToolState } from './agent-tools';
import { cameraCandidateEffect } from './camera-placement';
import { verifyWhyText, type WhyNumber, type WhyScope, type WhyUnit } from './explanation';

type ChatMetric = MetricCode | 'validation.errors' | 'validation.warnings' | 'zones.count' | 'equipment.violations' | 'coverage.percent' | 'zone.load';
/** Chat-only unit: the share of client zones seen by cameras (#32), not part of the advice contract. */
type ChatUnit = FactUnit | 'percent';
export type AgentFact = Omit<Fact, 'metric' | 'unit'> & {
  metric: ChatMetric;
  unit: ChatUnit;
  /** The scope distinguishes a filtered count from a whole-room count. */
  scope: string;
  recommendationId?: Id;
  candidateId?: Id;
  sourceFactId?: Id;
  metricLabel?: string;
};

const METRIC_LABELS: Record<ChatMetric, string> = {
  'area.total': 'Общая площадь',
  'area.occupied': 'Занятая площадь',
  'area.free': 'Свободная площадь',
  'equipment.count': 'Количество объектов',
  'equipment.min': 'Минимум по правилу комплектования',
  'equipment.max': 'Максимум по правилу комплектования',
  'objects.added': 'Добавлено объектов',
  'objects.removed': 'Удалено объектов',
  'placement.distance': 'Расстояние',
  'layout.passage': 'Самый узкий проход',
  'layout.entrance': 'Среднее расстояние до входа',
  'validation.errors': 'Ошибки проверки',
  'validation.warnings': 'Предупреждения проверки',
  'zones.count': 'Количество зон',
  'equipment.violations': 'Нарушения правил комплектования',
  'coverage.percent': 'Доля клиентских зон, видимая камерами',
  'zone.load': 'Загрузка зоны',
};
const PHASE_LABELS: Record<FactPhase, string> = {
  current: 'сейчас', before: 'было', after: 'стало', delta: 'изменение',
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * «name» (id): the chat UI turns this exact shape into a single button
 * labelled with the name (D-320). A room is never a button (`AgentChat`'s
 * matcher only resolves zones and objects among plan entities), so it is
 * named without an id to strand — the plain `${ref.id}` form used to leave
 * one bare and unclickable in the answer.
 */
function subject(state: AgentToolState, refs: readonly Ref[]): string {
  return refs.map((ref) => {
    if (ref.kind === 'room') return `«${state.names.nameOf(ref) ?? 'Помещение'}»`;
    return `«${state.names.nameOf(ref) ?? ref.id}» (${ref.id})`;
  }).join(', ');
}

/** Only named fields of known tools become facts; arbitrary numbers do not. */
export function collectAgentFacts(state: AgentToolState, records: readonly AgentToolRecord[]): AgentFact[] {
  const facts: AgentFact[] = [];
  const add = (id: string, metric: ChatMetric, value: unknown, refs: Ref[], scope: string): void => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    facts.push({ id, metric, phase: 'current', value, unit: metric.startsWith('area.') ? 'm2' : 'count', refs, scope });
  };
  const areas = (prefix: string, output: Record<string, unknown>, refs: Ref[], scope: string): void => {
    for (const [key, metric] of [['total_m2', 'area.total'], ['occupied_m2', 'area.occupied'], ['free_m2', 'area.free']] as const) {
      add(`${prefix}.${metric}`, metric, output[key], refs, scope);
    }
  };
  for (const [index, entry] of records.entries()) {
    const output = record(entry.output);
    if (output === null || 'error' in output) continue;
    const prefix = `read.${index}`;
    const roomRefs: Ref[] = [{ kind: 'room', id: state.plan.room.id }];
    const roomScope = subject(state, roomRefs);
    if (entry.name === 'plan_overview') {
      const room = record(output.room);
      if (room !== null) areas(`${prefix}.room`, room, roomRefs, roomScope);
      add(`${prefix}.objects`, 'equipment.count', output.objectsTotal, roomRefs, roomScope);
      // #217: before the zone areas — the facts budget must not cut them off.
      const load = record(output.zoneLoad);
      if (load !== null && load.unit === '%' && typeof load.threshold === 'number' && Array.isArray(load.zones)) {
        for (const raw of load.zones) {
          const zone = record(raw);
          if (zone === null || typeof zone.zoneId !== 'string' || typeof zone.value !== 'number' || !state.plan.zones.some((z) => z.id === zone.zoneId)) continue;
          const refs: Ref[] = [{ kind: 'zone', id: zone.zoneId }];
          const status = zone.overloaded === true ? 'перегружена' : 'не перегружена';
          const scope = `${subject(state, refs)}; ${status}, порог перегрузки ${String(load.threshold).replace('.', ',')} %`;
          facts.push({ id: `${prefix}.${zone.zoneId}.load`, metric: 'zone.load', phase: 'current', value: zone.value, unit: 'percent', refs, scope });
        }
      }
      if (Array.isArray(output.zones)) {
        add(`${prefix}.zones`, 'zones.count', output.zones.length, roomRefs, roomScope);
        for (const raw of output.zones) {
          const zone = record(raw);
          if (zone === null || typeof zone.zoneId !== 'string' || !state.plan.zones.some((z) => z.id === zone.zoneId)) continue;
          const refs: Ref[] = [{ kind: 'zone', id: zone.zoneId }];
          const scope = subject(state, refs);
          areas(`${prefix}.${zone.zoneId}`, zone, refs, scope);
          add(`${prefix}.${zone.zoneId}.objects`, 'equipment.count', zone.objects, refs, `${scope}, включая вложенные зоны`);
        }
      }
    }
    const coverage = entry.name === 'plan_overview' ? record(output.cameraCoverage) : null;
    if (coverage !== null) {
      const percent = (id: string, value: unknown, refs: Ref[], scope: string): void => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        facts.push({ id, metric: 'coverage.percent', phase: 'current', value, unit: 'percent', refs, scope });
      };
      const zones = Array.isArray(coverage.zones) ? coverage.zones.map(record).filter((zone) => zone !== null) : [];
      const cameraRefs: Ref[] = [...new Set(zones.flatMap((zone) => (Array.isArray(zone.cameraIds) ? zone.cameraIds : [])))]
        .filter((id): id is string => typeof id === 'string' && state.plan.objects.some((object) => object.id === id))
        .map((id) => ({ kind: 'object', id }));
      percent(`${prefix}.coverage`, coverage.percent, [...roomRefs, ...cameraRefs], 'все клиентские зоны');
      for (const zone of zones) {
        if (typeof zone.zoneId !== 'string' || !state.plan.zones.some((z) => z.id === zone.zoneId)) continue;
        const refs: Ref[] = [{ kind: 'zone', id: zone.zoneId }];
        percent(`${prefix}.${zone.zoneId}.coverage`, zone.percent, refs, subject(state, refs));
      }
    }
    if (entry.name === 'zone_details' && typeof output.zoneId === 'string' && state.plan.zones.some((z) => z.id === output.zoneId)) {
      const refs: Ref[] = [{ kind: 'zone', id: output.zoneId }];
      const scope = subject(state, refs);
      areas(`${prefix}.zone`, output, refs, scope);
      add(`${prefix}.objects`, 'equipment.count', output.objectsCount, refs, `${scope}, без вложенных зон`);
    }
    if (entry.name === 'list_objects') {
      const filter = record(output.filter);
      if (filter !== null) {
        const refs: Ref[] = typeof filter.zoneId === 'string' ? [{ kind: 'zone', id: filter.zoneId }] : roomRefs;
        const scope = [subject(state, refs), typeof filter.zoneId === 'string' ? 'без вложенных зон' : '', typeof filter.typeId === 'string' ? `тип «${state.names.objectTypeLabel(filter.typeId) ?? filter.typeId}»` : 'все типы'].filter(Boolean).join('; ');
        add(`${prefix}.objects`, 'equipment.count', output.count, refs, scope);
      }
    }
    if (entry.name === 'check_equipment' && Array.isArray(output.recommendations) && output.recommendations.length === 0) {
      const refs: Ref[] = typeof output.zoneId === 'string' ? [{ kind: 'zone', id: output.zoneId }] : roomRefs;
      add(`${prefix}.stocking`, 'equipment.violations', 0, refs, `${subject(state, refs)}; проверены правила комплектования`);
    }
    if (entry.name === 'plan_overview' || entry.name === 'validate_plan') {
      const validation = entry.name === 'validate_plan' ? output : record(output.validation);
      if (validation !== null) {
        add(`${prefix}.errors`, 'validation.errors', validation.errors, roomRefs, roomScope);
        add(`${prefix}.warnings`, 'validation.warnings', validation.warnings, roomRefs, roomScope);
      }
    }
  }
  for (const recommendation of state.recommendations.values()) {
    if (recommendation.scenario === 'place') facts.push(...coverageFacts(state, recommendation));
    const rule = recommendation.scenario === 'equipment'
      ? state.plan.catalog.rules.find((r) => recommendation.ruleIds.includes(r.id) && r.kind === 'count') : undefined;
    const typeId = recommendation.scenario === 'place' ? state.placementTypes.get(recommendation.id) : rule?.objectTypeId;
    for (const fact of recommendation.facts) {
      const candidate = recommendation.candidates.find((c) => c.facts.some((f) => f.id === fact.id));
      const scope = [
        subject(state, fact.refs),
        fact.metric.startsWith('equipment.') && typeId !== undefined ? `тип «${state.names.objectTypeLabel(typeId) ?? typeId}»` : '',
        fact.metric.startsWith('equipment.') && rule?.kind === 'count' ? `правило ${rule.id}, ${rule.scope === 'direct' ? 'без вложенных зон' : 'включая вложенные зоны'}` : '',
        candidate === undefined ? '' : candidateScope(recommendation, candidate),
      ].filter(Boolean).join('; ');
      // Candidate fact IDs are local to their search, not globally unique.
      const metricLabel = recommendation.scenario === 'compare' && fact.metric === 'layout.entrance'
        ? 'Расстояние от центра объекта до входа по правилу distance-to-entrance'
        : fact.metric !== 'placement.distance' ? undefined
        : recommendation.scenario === 'compare' ? 'Перемещено объектов, м (сумма): суммарное перемещение сохранившихся объектов между снимками'
          : 'Расстояние от варианта до центра зоны';
      facts.push({ ...fact, id: JSON.stringify([recommendation.id, fact.id]), sourceFactId: fact.id, refs: fact.refs.map((ref) => ({ ...ref })), scope, recommendationId: recommendation.id, ...(candidate === undefined ? {} : { candidateId: candidate.id }), ...(metricLabel === undefined ? {} : { metricLabel }) });
    }
  }
  // #126: the effect of an edit proposal — calculated on a copy of the plan.
  for (const proposal of state.proposals) {
    if (proposal.commands.length === 0) continue;
    // #122: a layout variant only moves objects — its area facts repeat the
    // plan, so only its passage and entrance go to the model, under its title.
    const layout = proposal.title !== undefined;
    const zone = layout ? proposal.facts.find((fact) => fact.metric.startsWith('layout.'))?.refs[0] : undefined;
    const refs: Ref[] = zone === undefined ? [{ kind: 'room', id: state.plan.room.id }] : [zone];
    const scope = layout ? `${subject(state, refs)}; ${proposal.title}` : `${subject(state, refs)}; с предложенными правками ${proposal.id}`;
    for (const fact of proposal.facts) {
      if (layout && !fact.metric.startsWith('layout.')) continue;
      facts.push({ ...fact, id: JSON.stringify([proposal.id, fact.id]), refs, scope });
    }
    for (const phase of ['before', 'after'] as const) {
      facts.push({ id: JSON.stringify([proposal.id, `errors.${phase}`]), metric: 'validation.errors', phase, value: proposal.findings.errors[phase], unit: 'count', refs, scope });
    }
  }
  return facts;
}

function candidateScope(recommendation: Recommendation, candidate: Candidate): string {
  // #210: no coordinates — the variant is on the plan; its number and label name it.
  return `вариант ${recommendation.candidates.indexOf(candidate) + 1} «${candidate.object.label}»`;
}

/**
 * #32: for a camera variant, the share of client zones seen before, after and
 * the change — recomputed from the plan and the candidate by the same
 * `cameraCoverage` the layer draws. «Before» cites the cameras that see the
 * client zones now, so the answer highlights them.
 */
function coverageFacts(state: AgentToolState, recommendation: Recommendation): AgentFact[] {
  const facts: AgentFact[] = [];
  const roomRefs: Ref[] = [{ kind: 'room', id: state.plan.room.id }];
  for (const candidate of recommendation.candidates) {
    const effect = cameraCandidateEffect(state.plan, candidate);
    if (effect === null || effect.before.total.percent === null || effect.after.total.percent === null) continue;
    const cameras = [...new Set(effect.before.zones.flatMap((zone) => zone.cameraIds))];
    const scope = `все клиентские зоны; ${candidateScope(recommendation, candidate)}`;
    const base = { recommendationId: recommendation.id, candidateId: candidate.id, metric: 'coverage.percent' as const, unit: 'percent' as const, scope };
    const id = (phase: FactPhase): string => JSON.stringify([recommendation.id, `${candidate.id}.coverage.${phase}`]);
    facts.push(
      { ...base, id: id('before'), phase: 'before', value: effect.before.total.percent, refs: [...roomRefs, ...cameras.map((cameraId) => ({ kind: 'object' as const, id: cameraId }))] },
      { ...base, id: id('after'), phase: 'after', value: effect.after.total.percent, refs: roomRefs },
      // The change of the shares as rendered (tenths): «29,8 → 72,1, +42,3» adds up on paper.
      { ...base, id: id('delta'), phase: 'delta', value: Math.round(effect.after.total.percent * 10) / 10 - Math.round(effect.before.total.percent * 10) / 10, refs: roomRefs },
    );
  }
  return facts;
}

const UNIT_LABELS: Record<ChatUnit, string> = { m2: 'м²', m: 'м', count: 'шт.', percent: '%' };

/** Signed deltas and units come from the selected fact, not from the model. */
export function renderAgentFact(fact: AgentFact): string {
  const value = Math.round(fact.value * (fact.unit === 'percent' ? 10 : 100)) / (fact.unit === 'percent' ? 10 : 100);
  const number = `${fact.phase === 'delta' && value > 0 ? '+' : ''}${String(value).replace('.', ',')}`;
  // A change of a share is in percentage points, not per cent of the share.
  const unit = fact.unit === 'percent' && fact.phase === 'delta' ? 'п. п.' : UNIT_LABELS[fact.unit];
  return `${fact.metricLabel ?? METRIC_LABELS[fact.metric]} — ${fact.scope}: ${number} ${unit} (${PHASE_LABELS[fact.phase]}).`;
}

/** #178: «почему сюда» — 2–3 sentences; longer is a report, not a reason. */
export const WHY_MAX_CHARS = 600;
/** Opens the model's own paragraph, so the reader knows who wrote it. */
export const WHY_LEAD = 'Почему так (текст LLM, id и числа сверены с расчётом): ';

const selectionSchema = z.object({
  factIds: z.array(z.string().min(1)).min(1).max(12),
  why: z.string().trim().min(1).max(WHY_MAX_CHARS).optional(),
}).strict();
/** `why: true` — the facts held, the model's own text did not. */
export type AgentFactSelection = { ok: true; text: string; refs: Ref[] } | { ok: false; reason: string; why?: true };

/** Tools whose results are the variants a «почему сюда» text compares. */
const VARIANT_TOOLS = new Set(['find_place', 'layout_zone']);
/** Where a variant stands is not a reason; leaving coordinates out keeps the numbers few. */
const POSE_KEYS = new Set(['position_m', 'rotation_deg']);
const UNITS: readonly WhyUnit[] = ['m', 'm2', 'percent', 'count'];

/** The unit a tool output key names: `free_m2`, `wallGap_m`, `coveragePercent`, `area.free.after`. */
function keyUnit(key: string, inherited: WhyUnit): WhyUnit {
  if (/_m2$|^area\./.test(key)) return 'm2';
  if (/_m$|^placement\.distance|^layout\./.test(key)) return 'm';
  if (/percent|^coverage\./i.test(key)) return 'percent';
  return inherited;
}

/**
 * What the «почему сюда» text may name: plan ids and names, the facts offered,
 * the numbers of the tools that gave the variants, and how many variants there are.
 */
function whyScope(state: AgentToolState, facts: readonly AgentFact[], records: readonly AgentToolRecord[]): WhyScope {
  const { plan } = state;
  const numbers: WhyNumber[] = facts.map((fact) => ({ value: fact.value, unit: fact.unit }));
  // A value without a unit in its key or beside it (`{value, unit}`) is a count.
  const collect = (value: unknown, unit: WhyUnit): void => {
    if (typeof value === 'number' && Number.isFinite(value)) numbers.push({ value, unit });
    else if (Array.isArray(value)) for (const entry of value) collect(entry, unit);
    else if (typeof value === 'object' && value !== null) {
      const own = UNITS.find((entry) => entry === (value as { unit?: unknown }).unit) ?? unit;
      for (const [key, entry] of Object.entries(value)) if (!POSE_KEYS.has(key)) collect(entry, keyUnit(key, own));
    }
  };
  for (const entry of records) {
    const output = record(entry.output);
    if (VARIANT_TOOLS.has(entry.name) && output !== null && !('error' in output)) collect(output, 'count');
  }
  // A rule's own limits («не дальше 3 м от входа») are plan data, not the model's.
  collect(plan.catalog.rules, 'count');
  // Candidates of a placement and titled proposals (#122 layouts, #177 moves) are «Вариант N».
  const variants = Math.max(
    0,
    ...[...state.recommendations.values()].map((recommendation) => recommendation.candidates.length),
    ...state.proposals.map((proposal) => Number(/^Вариант (\d+)/.exec(proposal.title ?? '')?.[1] ?? 0)),
  );
  numbers.push({ value: variants, unit: 'count' });
  const { catalog } = plan;
  return {
    ids: new Set([...plan.zones, ...plan.objects, ...plan.layers, ...catalog.objectTypes, ...catalog.zoneTypes, ...catalog.rules].map((entry) => entry.id)),
    rules: new Set(catalog.rules.map((rule) => rule.id)),
    shown: new Set([...plan.zones, ...plan.objects].map((entry) => entry.id)),
    names: new Map([
      ...plan.zones.map((zone) => [zone.id, zone.name] as const),
      ...plan.objects.map((object) => [object.id, object.label] as const),
      ...plan.layers.map((layer) => [layer.id, layer.name] as const),
      ...catalog.objectTypes.map((type) => [type.id, type.label] as const),
      ...catalog.zoneTypes.map((type) => [type.id, type.label] as const),
    ]),
    numbers,
    variants,
  };
}

/**
 * No value overrides can pass this boundary. Free prose passes only as `why`
 * (#178), after `verifyWhyText` found every id, number and variant in the
 * calculation; it opens the answer, the chosen facts follow as code wrote them.
 */
export function renderAgentFactSelection(input: unknown, facts: readonly AgentFact[], state: AgentToolState, records: readonly AgentToolRecord[] = []): AgentFactSelection {
  let payload = input;
  if (typeof input === 'string') {
    try { payload = JSON.parse(input); }
    catch { return { ok: false, reason: 'Ожидался выбор рассчитанных фактов, а не свободный текст.' }; }
  }
  const parsed = selectionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: `Ответ должен содержать только factIds рассчитанных фактов и, к вариантам места, why до ${WHY_MAX_CHARS} символов.` };
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const selected: AgentFact[] = [];
  for (const id of parsed.data.factIds) {
    const fact = byId.get(id);
    if (fact === undefined) return { ok: false, reason: `Неизвестный рассчитанный факт: ${id}.` };
    if (fact.candidateId !== undefined && state.actions.some((action) =>
      (action.kind === 'apply-candidate' || action.kind === 'preview-candidate') && action.recommendationId === fact.recommendationId && action.candidateId !== fact.candidateId)) {
      return { ok: false, reason: 'Факт относится к другому варианту, а не к предложенному на плане.' };
    }
    if (!selected.includes(fact)) selected.push(fact);
  }
  // Selecting a numerical fact also selects its inseparable assumptions.
  const notes = new Set<string>();
  for (const fact of selected) {
    if (fact.recommendationId === undefined) continue;
    const recommendation = state.recommendations.get(fact.recommendationId);
    if (recommendation === undefined) return { ok: false, reason: 'Рекомендация факта больше недоступна.' };
    for (const note of [...recommendation.assumptions, ...recommendation.limitations]) notes.add(note);
  }
  const refs = new Map<string, Ref>();
  for (const fact of selected) for (const ref of fact.refs) refs.set(`${ref.kind}:${ref.id}`, { ...ref });
  let why: string[] = [];
  if (parsed.data.why !== undefined) {
    const checked = verifyWhyText(parsed.data.why, whyScope(state, facts, records));
    if (!checked.ok) return { ok: false, reason: checked.issues.map((entry) => entry.message).join(' '), why: true };
    why = [`${WHY_LEAD}${checked.value}`];
  }
  // The variants' own numbers follow the model's words, written by code (#178).
  const variants = relocationParagraphs(state, records);
  return { ok: true, text: [...why, ...variants, ...selected.map(renderAgentFact), ...notes].join('\n\n'), refs: [...refs.values()] };
}
