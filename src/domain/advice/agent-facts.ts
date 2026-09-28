/**
 * Issue #3: the model chooses a fact, never its metric, subject, unit or value.
 * This internal catalog is built from successful read tools and calculated
 * recommendations. User questions and conversation history are not evidence.
 */
import { z } from 'zod';
import type { Fact, FactPhase, MetricCode } from '../../contracts/advice';
import type { Id, Ref } from '../../contracts/model';
import type { AgentToolRecord } from './agent-fallback';
import type { AgentToolState } from './agent-tools';

type ChatMetric = MetricCode | 'validation.errors' | 'validation.warnings' | 'zones.count';
export type AgentFact = Omit<Fact, 'metric'> & {
  metric: ChatMetric;
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
  'validation.errors': 'Ошибки проверки',
  'validation.warnings': 'Предупреждения проверки',
  'zones.count': 'Количество зон',
};
const PHASE_LABELS: Record<FactPhase, string> = {
  current: 'сейчас', before: 'было', after: 'стало', delta: 'изменение',
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function subject(state: AgentToolState, refs: readonly Ref[]): string {
  return refs.map((ref) => {
    if (ref.kind === 'room') return `помещение (${ref.id})`;
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
    if (entry.name === 'zone_details' && typeof output.zoneId === 'string' && state.plan.zones.some((z) => z.id === output.zoneId)) {
      const refs: Ref[] = [{ kind: 'zone', id: output.zoneId }];
      const scope = subject(state, refs);
      areas(`${prefix}.zone`, output, refs, scope);
      add(`${prefix}.objects`, 'equipment.count', output.objectsCount, refs, `${scope}, без вложенных зон`);
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
    const rule = recommendation.scenario === 'equipment'
      ? state.plan.catalog.rules.find((r) => recommendation.ruleIds.includes(r.id) && r.kind === 'count') : undefined;
    const typeId = recommendation.scenario === 'place' ? state.placementTypes.get(recommendation.id) : rule?.objectTypeId;
    for (const fact of recommendation.facts) {
      const candidate = recommendation.candidates.find((c) => c.facts.some((f) => f.id === fact.id));
      const scope = [
        subject(state, fact.refs),
        fact.metric.startsWith('equipment.') && typeId !== undefined ? `тип «${state.names.objectTypeLabel(typeId) ?? typeId}» (${typeId})` : '',
        fact.metric.startsWith('equipment.') && rule?.kind === 'count' ? `правило ${rule.id}, ${rule.scope === 'direct' ? 'без вложенных зон' : 'включая вложенные зоны'}` : '',
        candidate === undefined ? '' : `вариант «${candidate.object.label}» (${candidate.id}), поиск ${recommendation.id}, центр [${candidate.object.position.map((v) => String(v).replace('.', ',')).join('; ')}] м`,
      ].filter(Boolean).join('; ');
      // Candidate fact IDs are local to their search, not globally unique.
      const metricLabel = fact.metric !== 'placement.distance' ? undefined
        : recommendation.scenario === 'compare' ? 'Суммарное перемещение сохранившихся объектов между снимками'
          : 'Расстояние от центра кандидата до середины ограничивающего прямоугольника выбранной зоны или помещения';
      facts.push({ ...fact, id: JSON.stringify([recommendation.id, fact.id]), sourceFactId: fact.id, refs: fact.refs.map((ref) => ({ ...ref })), scope, recommendationId: recommendation.id, ...(candidate === undefined ? {} : { candidateId: candidate.id }), ...(metricLabel === undefined ? {} : { metricLabel }) });
    }
  }
  return facts;
}

/** Signed deltas and units come from the selected fact, not from the model. */
export function renderAgentFact(fact: AgentFact): string {
  const value = Math.round(fact.value * 100) / 100;
  const number = `${fact.phase === 'delta' && value > 0 ? '+' : ''}${String(value).replace('.', ',')}`;
  const unit = fact.unit === 'm2' ? 'м²' : fact.unit === 'm' ? 'м' : 'шт.';
  return `${fact.metricLabel ?? METRIC_LABELS[fact.metric]} — ${fact.scope}: ${number} ${unit} (${PHASE_LABELS[fact.phase]}).`;
}

const selectionSchema = z.object({ factIds: z.array(z.string().min(1)).min(1).max(12) }).strict();
export type AgentFactSelection = { ok: true; text: string; refs: Ref[] } | { ok: false; reason: string };

/** No free prose or value overrides can pass this boundary, even in words. */
export function renderAgentFactSelection(input: unknown, facts: readonly AgentFact[], state: AgentToolState): AgentFactSelection {
  let payload = input;
  if (typeof input === 'string') {
    try { payload = JSON.parse(input); }
    catch { return { ok: false, reason: 'Ожидался выбор рассчитанных фактов, а не свободный текст.' }; }
  }
  const parsed = selectionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'Ответ должен содержать только factIds рассчитанных фактов.' };
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const selected: AgentFact[] = [];
  for (const id of parsed.data.factIds) {
    const fact = byId.get(id);
    if (fact === undefined) return { ok: false, reason: `Неизвестный рассчитанный факт: ${id}.` };
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
  return { ok: true, text: [...selected.map(renderAgentFact), ...notes].join('\n\n'), refs: [...refs.values()] };
}
