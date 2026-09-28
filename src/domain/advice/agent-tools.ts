/**
 * Tools of the plan agent (D-258): the only way the model sees the plan.
 *
 * Read tools return what the calculation produced — areas, placements, stocking
 * rules, validation, the diff with the opened plan — rounded to centimetres so
 * the model has nothing to invent precision from. Interface tools only attach
 * actions to the answer; each is checked against the current plan here, and a
 * refused call comes back to the model as an error it can correct.
 *
 * Nothing here edits the document.
 */

import { z } from 'zod';
import type { Recommendation } from '../../contracts/advice';
import type { AgentPanel, AgentStep, AgentToolName, AssistantAction } from '../../contracts/advice-chat';
import type { Id, PlanDocument, Ref } from '../../contracts/model';
import { buildInventory } from '../inventory';
import { measurePlan } from '../metrics';
import { planIndex, type PlanIndex } from '../plan-index';
import { validatePlan } from '../validation';
import { calculateAdvice } from './index';

export type AgentToolState = {
  plan: PlanDocument;
  before: PlanDocument | null;
  names: PlanIndex;
  /** Everything the read tools calculated in this exchange, by id. */
  recommendations: Map<Id, Recommendation>;
  /** Placement's requested type remains known even when no candidate fits. */
  placementTypes: Map<Id, Id>;
  actions: AssistantAction[];
  refs: Ref[];
};

export type AgentToolOutcome = { output: unknown; step: AgentStep };

export function createAgentToolState(plan: PlanDocument, before: PlanDocument | null): AgentToolState {
  return { plan, before, names: planIndex(plan), recommendations: new Map(), placementTypes: new Map(), actions: [], refs: [] };
}

const PANEL_LABELS: Record<AgentPanel, string> = {
  metrics: 'Площади',
  validation: 'Проверка',
  inventory: 'Инвентаризация',
};

const MAX_LISTED_OBJECTS = 40;
const MAX_LISTED_ISSUES = 15;

const round = (value: number): number => Math.round(value * 100) / 100;

const nullableId = z.string().min(1).nullish().transform((value) => value ?? null);

const argSchemas = {
  plan_overview: z.object({}).passthrough(),
  zone_details: z.object({ zoneId: z.string().min(1) }),
  list_objects: z.object({ typeId: nullableId, zoneId: nullableId }),
  find_place: z.object({ typeId: z.string().min(1), zoneId: nullableId }),
  check_equipment: z.object({ zoneId: nullableId }),
  validate_plan: z.object({}).passthrough(),
  compare_with_original: z.object({}).passthrough(),
  show_on_plan: z.object({ ids: z.array(z.string().min(1)).min(1).max(12) }),
  suggest_candidate: z.object({ recommendationId: z.string().min(1), candidateId: z.string().min(1) }),
  suggest_layer: z.object({ layerId: z.string().min(1) }),
  open_panel: z.object({ panel: z.enum(['metrics', 'validation', 'inventory']) }),
} satisfies Record<AgentToolName, z.ZodType>;

/** JSON Schemas for the provider's `tools` field, in the same order as above. */
export const AGENT_TOOL_SPECS: { name: AgentToolName; description: string; parameters: unknown }[] = [
  {
    name: 'plan_overview',
    description:
      'Сводка текущего плана: площадь помещения, занято и свободно, зоны с площадями и числом объектов, оборудование по типам, информационные слои, число ошибок проверки. Вызывай первым, если вопрос общий.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'zone_details',
    description: 'Одна зона: площадь, свободная площадь, вложенные зоны, объекты в ней и синтетические атрибуты зоны (посетители, сотрудники и т. п.).',
    parameters: { type: 'object', properties: { zoneId: { type: 'string' } }, required: ['zoneId'] },
  },
  {
    name: 'list_objects',
    description: 'Список объектов плана с фильтром по типу и/или зоне (до 40 строк).',
    parameters: {
      type: 'object',
      properties: { typeId: { type: ['string', 'null'] }, zoneId: { type: ['string', 'null'] } },
    },
  },
  {
    name: 'find_place',
    description:
      'Расчёт свободного места для нового объекта типа typeId (в зоне zoneId или по уместным зонам, если null). Возвращает до трёх вариантов с позицией и свободной площадью было → стало.',
    parameters: {
      type: 'object',
      properties: { typeId: { type: 'string' }, zoneId: { type: ['string', 'null'] } },
      required: ['typeId'],
    },
  },
  {
    name: 'check_equipment',
    description: 'Проверка комплектования по правилам справочника: какого оборудования не хватает или слишком много, в зоне zoneId или во всём плане (null).',
    parameters: { type: 'object', properties: { zoneId: { type: ['string', 'null'] } } },
  },
  {
    name: 'validate_plan',
    description: 'Ошибки и предупреждения проверки плана: пересечения, выход за зону или помещение, нарушения правил.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'compare_with_original',
    description: 'Что изменилось относительно открытого варианта плана: добавленные, удалённые, перемещённые объекты и свободная площадь было → стало.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'show_on_plan',
    description: 'Подсветить на плане зоны или объекты, о которых идёт речь (id из результатов инструментов).',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  {
    name: 'suggest_candidate',
    description:
      'Предложить человеку вариант из find_place: он будет показан на плане полупрозрачно и получит кнопку «Применить». Сам план не меняется.',
    parameters: {
      type: 'object',
      properties: { recommendationId: { type: 'string' }, candidateId: { type: 'string' } },
      required: ['recommendationId', 'candidateId'],
    },
  },
  {
    name: 'suggest_layer',
    description: 'Предложить включить информационный слой (камеры, тепловая нагрузка, сотрудники, очередь), если он помогает ответу.',
    parameters: { type: 'object', properties: { layerId: { type: 'string' } }, required: ['layerId'] },
  },
  {
    name: 'open_panel',
    description: 'Открыть рядом с ответом панель: metrics — площади, validation — проверка, inventory — инвентаризация.',
    parameters: {
      type: 'object',
      properties: { panel: { type: 'string', enum: ['metrics', 'validation', 'inventory'] } },
      required: ['panel'],
    },
  },
];

export function isAgentTool(name: string): name is AgentToolName {
  return Object.hasOwn(argSchemas, name);
}

function refOf(plan: PlanDocument, id: Id): Ref | null {
  if (plan.zones.some((zone) => zone.id === id)) return { kind: 'zone', id };
  if (plan.objects.some((object) => object.id === id)) return { kind: 'object', id };
  return null;
}

function addRef(state: AgentToolState, ref: Ref): void {
  if (ref.kind !== 'zone' && ref.kind !== 'object') return;
  if (!state.refs.some((entry) => entry.kind === ref.kind && entry.id === ref.id)) state.refs.push(ref);
}

function addAction(state: AgentToolState, action: AssistantAction): void {
  const key = JSON.stringify(action);
  if (!state.actions.some((entry) => JSON.stringify(entry) === key)) state.actions.push(action);
}

function zoneName(state: AgentToolState, id: Id | null): string | null {
  return id === null ? null : state.names.zoneName(id);
}

function primitiveAttributes(attributes: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'number') out[key] = round(value);
    else if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** What the model reads about a recommendation: ids, rounded facts, the team's rules. */
function recommendationView(state: AgentToolState, recommendation: Recommendation): unknown {
  const candidateFacts = new Set(recommendation.candidates.flatMap((candidate) => candidate.facts.map((fact) => fact.id)));
  return {
    recommendationId: recommendation.id,
    reasonCodes: recommendation.reasonCodes,
    refs: recommendation.refs.map((ref) => ({ kind: ref.kind, id: ref.id, name: state.names.nameOf(ref) })),
    facts: recommendation.facts
      .filter((fact) => !candidateFacts.has(fact.id))
      .map((fact) => ({ metric: fact.metric, phase: fact.phase, value: round(fact.value), unit: fact.unit, about: fact.refs.map((ref) => ref.id) })),
    candidates: recommendation.candidates.map((candidate) => ({
      candidateId: candidate.id,
      zoneId: candidate.object.zoneId,
      zoneName: zoneName(state, candidate.object.zoneId),
      position_m: candidate.object.position.map(round),
      size_m: candidate.object.size_m.map(round),
      rotation_deg: candidate.object.rotation_deg,
      facts: Object.fromEntries(candidate.facts.map((fact) => [`${fact.metric}.${fact.phase}`, round(fact.value)])),
    })),
    changes: recommendation.changes.slice(0, 20).map((change) => ({ kind: change.kind, id: change.ref.id, name: state.names.nameOf(change.ref) })),
    ruleIds: recommendation.ruleIds,
    assumptions: recommendation.assumptions,
    limitations: recommendation.limitations,
  };
}

function remember(state: AgentToolState, recommendations: Recommendation[]): void {
  for (const recommendation of recommendations) {
    state.recommendations.set(recommendation.id, recommendation);
    for (const ref of recommendation.refs) addRef(state, ref);
  }
}

function fail(tool: AgentToolName, label: string, error: string): AgentToolOutcome {
  return { output: { error }, step: { tool, label, ok: false } };
}

function overview(state: AgentToolState): AgentToolOutcome {
  const { plan } = state;
  const measured = measurePlan(plan);
  const inventory = buildInventory(plan);
  const issues = validatePlan(plan);
  const metrics = measured.ok ? measured.value : null;
  return {
    output: {
      planName: plan.name,
      room:
        metrics === null
          ? { error: measured.ok ? null : measured.issues.map((issue) => issue.message).join('; ') }
          : { total_m2: round(metrics.room.total_m2), occupied_m2: round(metrics.room.occupied_m2), free_m2: round(metrics.room.free_m2) },
      zones: plan.zones.map((zone) => ({
        zoneId: zone.id,
        name: zone.name,
        type: state.names.zoneTypeLabel(zone.typeId),
        parentId: zone.parentId,
        total_m2: metrics === null ? null : round(metrics.zones[zone.id]?.total_m2 ?? 0),
        free_m2: metrics === null ? null : round(metrics.zones[zone.id]?.free_m2 ?? 0),
        objects: inventory.byZoneInclusive[zone.id] ?? 0,
      })),
      objectsTotal: plan.objects.length,
      unassignedObjects: inventory.unassigned,
      byType: Object.entries(inventory.byType)
        .filter(([, count]) => count > 0)
        .map(([typeId, count]) => ({ typeId, label: state.names.objectTypeLabel(typeId), count })),
      catalogTypes: plan.catalog.objectTypes.map((type) => ({ typeId: type.id, label: type.label })),
      layers: plan.layers.map((layer) => ({ layerId: layer.id, name: layer.name, visible: layer.visible, informational: layer.typeId !== null })),
      validation: {
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity !== 'error').length,
      },
    },
    step: { tool: 'plan_overview', label: 'Сводка плана: площади, зоны, оборудование', ok: true },
  };
}

/**
 * Runs one tool call. Unknown tools and malformed arguments are answered with
 * an error for the model, never thrown: the loop continues and can recover.
 */
export function runAgentTool(state: AgentToolState, name: string, rawArgs: unknown): AgentToolOutcome {
  if (!isAgentTool(name)) {
    return { output: { error: `Инструмента «${name}» нет.` }, step: { tool: 'plan_overview', label: `Неизвестный инструмент «${name}»`, ok: false } };
  }
  const parsed = argSchemas[name].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return fail(name, 'Неверные параметры инструмента', `Неверные параметры: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} — ${issue.message}`).join('; ')}`);
  }
  const { plan } = state;

  switch (name) {
    case 'plan_overview':
      return overview(state);

    case 'zone_details': {
      const { zoneId } = argSchemas.zone_details.parse(rawArgs);
      const zone = plan.zones.find((entry) => entry.id === zoneId);
      if (zone === undefined) return fail(name, 'Зона не найдена', `Зоны «${zoneId}» нет в плане. Список зон — в plan_overview.`);
      const measured = measurePlan(plan);
      const area = measured.ok ? measured.value.zones[zone.id] : undefined;
      const objects = plan.objects.filter((object) => object.zoneId === zone.id);
      addRef(state, { kind: 'zone', id: zone.id });
      return {
        output: {
          zoneId: zone.id,
          name: zone.name,
          type: state.names.zoneTypeLabel(zone.typeId),
          parent: zone.parentId === null ? null : { zoneId: zone.parentId, name: zoneName(state, zone.parentId) },
          children: plan.zones.filter((entry) => entry.parentId === zone.id).map((entry) => ({ zoneId: entry.id, name: entry.name })),
          total_m2: area === undefined ? null : round(area.total_m2),
          occupied_m2: area === undefined ? null : round(area.occupied_m2),
          free_m2: area === undefined ? null : round(area.free_m2),
          attributes: primitiveAttributes(zone.attributes),
          syntheticNote: 'Атрибуты зоны синтетические, не измерены.',
          objectsCount: objects.length,
          objects: objects.slice(0, MAX_LISTED_OBJECTS).map((object) => ({ id: object.id, label: object.label, typeId: object.typeId })),
        },
        step: { tool: name, label: `Зона «${zone.name}»: площадь и состав`, ok: true },
      };
    }

    case 'list_objects': {
      const { typeId, zoneId } = argSchemas.list_objects.parse(rawArgs);
      if (typeId !== null && state.names.objectTypeLabel(typeId) === null) return fail(name, 'Тип оборудования не найден', `Типа «${typeId}» нет в справочнике. Типы — в plan_overview.catalogTypes.`);
      if (zoneId !== null && zoneName(state, zoneId) === null) return fail(name, 'Зона не найдена', `Зоны «${zoneId}» нет в плане.`);
      const rows = plan.objects.filter((object) => (typeId === null || object.typeId === typeId) && (zoneId === null || object.zoneId === zoneId));
      const filters = [typeId === null ? null : `тип «${state.names.objectTypeLabel(typeId) ?? typeId}»`, zoneId === null ? null : `зона «${zoneName(state, zoneId) ?? zoneId}»`].filter(Boolean);
      return {
        output: {
          count: rows.length,
          objects: rows.slice(0, MAX_LISTED_OBJECTS).map((object) => ({
            id: object.id,
            label: object.label,
            typeId: object.typeId,
            zoneId: object.zoneId,
            zoneName: zoneName(state, object.zoneId),
          })),
          truncated: rows.length > MAX_LISTED_OBJECTS,
        },
        step: { tool: name, label: filters.length === 0 ? 'Список оборудования' : `Список оборудования: ${filters.join(', ')}`, ok: true },
      };
    }

    case 'find_place': {
      const { typeId, zoneId } = argSchemas.find_place.parse(rawArgs);
      const typeLabel = state.names.objectTypeLabel(typeId);
      if (typeLabel === null) return fail(name, 'Тип оборудования не найден', `Типа «${typeId}» нет в справочнике. Типы — в plan_overview.catalogTypes.`);
      if (zoneId !== null && zoneName(state, zoneId) === null) return fail(name, 'Зона не найдена', `Зоны «${zoneId}» нет в плане.`);
      const label = `Поиск места: «${typeLabel}»${zoneId === null ? '' : ` в зоне «${zoneName(state, zoneId)}»`}`;
      const calculated = calculateAdvice(plan, { scenario: 'place', typeId, zoneId });
      if (!calculated.ok) return fail(name, label, calculated.issues.map((issue) => issue.message).join('; '));
      remember(state, calculated.value);
      for (const entry of calculated.value) state.placementTypes.set(entry.id, typeId);
      return { output: { recommendations: calculated.value.map((entry) => recommendationView(state, entry)) }, step: { tool: name, label, ok: true } };
    }

    case 'check_equipment': {
      const { zoneId } = argSchemas.check_equipment.parse(rawArgs);
      if (zoneId !== null && zoneName(state, zoneId) === null) return fail(name, 'Зона не найдена', `Зоны «${zoneId}» нет в плане.`);
      const label = zoneId === null ? 'Проверка комплектования по правилам' : `Проверка комплектования: «${zoneName(state, zoneId)}»`;
      const calculated = calculateAdvice(plan, { scenario: 'equipment', zoneId });
      if (!calculated.ok) return fail(name, label, calculated.issues.map((issue) => issue.message).join('; '));
      remember(state, calculated.value);
      return {
        output: { recommendations: calculated.value.map((entry) => recommendationView(state, entry)), note: calculated.value.length === 0 ? 'Нарушений правил комплектования нет.' : undefined },
        step: { tool: name, label, ok: true },
      };
    }

    case 'validate_plan': {
      const issues = validatePlan(plan);
      for (const issue of issues.slice(0, MAX_LISTED_ISSUES)) for (const ref of issue.refs) addRef(state, ref);
      return {
        output: {
          errors: issues.filter((issue) => issue.severity === 'error').length,
          warnings: issues.filter((issue) => issue.severity !== 'error').length,
          issues: issues.slice(0, MAX_LISTED_ISSUES).map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message, ids: issue.refs.map((ref) => ref.id) })),
        },
        step: { tool: name, label: 'Проверка плана: ошибки и предупреждения', ok: true },
      };
    }

    case 'compare_with_original': {
      const label = 'Сравнение с открытым вариантом';
      if (state.before === null) return fail(name, label, 'Исходный вариант плана недоступен.');
      const calculated = calculateAdvice(plan, { scenario: 'compare', before: state.before });
      if (!calculated.ok) return fail(name, label, calculated.issues.map((issue) => issue.message).join('; '));
      remember(state, calculated.value);
      return { output: { recommendations: calculated.value.map((entry) => recommendationView(state, entry)) }, step: { tool: name, label, ok: true } };
    }

    case 'show_on_plan': {
      const { ids } = argSchemas.show_on_plan.parse(rawArgs);
      const refs = ids.map((id) => refOf(plan, id));
      const unknown = ids.filter((_, index) => refs[index] === null);
      if (unknown.length > 0) return fail(name, 'Подсветка: объект не найден', `В плане нет зон или объектов: ${unknown.join(', ')}.`);
      const known = refs.filter((ref): ref is Ref => ref !== null);
      for (const ref of known) {
        addRef(state, ref);
        addAction(state, { kind: 'focus', ref });
      }
      const shown = known.map((ref) => state.names.nameOf(ref) ?? ref.id);
      return { output: { ok: true }, step: { tool: name, label: `Подсветка на плане: ${shown.join(', ')}`, ok: true } };
    }

    case 'suggest_candidate': {
      const { recommendationId, candidateId } = argSchemas.suggest_candidate.parse(rawArgs);
      const candidate = state.recommendations.get(recommendationId)?.candidates.find((entry) => entry.id === candidateId);
      if (candidate === undefined) {
        return fail(name, 'Вариант не найден', `Вариант «${candidateId}» не из расчёта find_place этого ответа (рекомендация «${recommendationId}»).`);
      }
      addAction(state, { kind: 'preview-candidate', recommendationId, candidateId });
      addAction(state, { kind: 'apply-candidate', recommendationId, candidateId });
      if (candidate.object.zoneId !== null) addRef(state, { kind: 'zone', id: candidate.object.zoneId });
      return {
        output: { ok: true, note: 'Вариант показан на плане, применит его человек кнопкой «Применить».' },
        step: { tool: name, label: `Вариант «${candidate.object.label}» предложен к применению`, ok: true },
      };
    }

    case 'suggest_layer': {
      const { layerId } = argSchemas.suggest_layer.parse(rawArgs);
      const layer = plan.layers.find((entry) => entry.id === layerId);
      if (layer === undefined) return fail(name, 'Слой не найден', `Слоя «${layerId}» нет в плане.`);
      addAction(state, { kind: 'show-layer', layerId });
      return { output: { ok: true, visible: layer.visible }, step: { tool: name, label: `Слой «${layer.name}»`, ok: true } };
    }

    case 'open_panel': {
      const { panel } = argSchemas.open_panel.parse(rawArgs);
      addAction(state, { kind: 'open-panel', panel });
      return { output: { ok: true }, step: { tool: name, label: `Панель «${PANEL_LABELS[panel]}»`, ok: true } };
    }
  }
}
