/**
 * E01: builds the three files of the submission from one source of truth.
 *
 * `before.json` is not typed by hand: it is assembled by the editor's own
 * commands (`applyCommand`), so the zone of every object is computed by
 * `relations.reconcile` exactly as it is when a person drags the object on the
 * canvas. The recommendation is the real output of `calculateAdvice` — the same
 * function the assistant panel calls — and `after.json` is that recommendation
 * applied, again through commands.
 *
 * The explanation has two honest sources (D-188). With a provider configured
 * in the environment — the same `LLM_*` variables the server reads — the
 * builder asks the model through the very `/api/advice` route the app uses, and
 * the model's choice is kept only if it passed `verifyExplanation`: then the
 * file says `mode: 'llm'` with provider, model and date. Without a provider, on
 * an HTTP error or on an answer the check refused, the file says
 * `mode: 'fallback'` and why. Either way every number comes from the code.
 *
 * Without a provider nothing here is random and nothing depends on the clock:
 * running the script twice produces byte-identical files, which is what
 * `tests/demo.test.ts` checks. An llm build differs only in the model's choice
 * and the date, and the test rebuilds everything else from the file.
 *
 * Run: npx tsx demo/build.ts                       (без модели)
 *      npx tsx --env-file=.env demo/build.ts       (с провайдером из .env)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerAdviceRoutes } from '../server/advice-route';
import { readLlmConfig, type Env, type LlmConfig } from '../server/config';
import { createLlmClient } from '../server/llm-client';
import type {
  AdviceMode,
  AdviceRequest,
  AdviceResponse,
  Explanation,
  Recommendation,
} from '../src/contracts/advice';
import type {
  Catalog,
  Equipment,
  Id,
  Issue,
  Layer,
  ObjectType,
  PlanDocument,
} from '../src/contracts/model';
import { LIMITS, SCHEMA_VERSION } from '../src/contracts/model';
import { parseCatalog } from '../src/contracts/schema';
import {
  calculateAdvice,
  defaultExplanation,
  renderExplanation,
  verifyExplanation,
} from '../src/domain/advice';
import { findObjectType } from '../src/domain/catalog';
import { openingCentre } from '../src/domain/geometry';
import { applyCommand } from '../src/domain/commands';
import { buildInventory, countInZoneScope } from '../src/domain/inventory';
import { measurePlan } from '../src/domain/metrics';
import { validatePlan } from '../src/domain/validation';
import { encodePlan } from '../src/persistence/codec';
import {
  CEILING_M,
  OBJECTS,
  OPENINGS,
  ROOM_BOUNDARY,
  WALLS,
  WALL_M,
  ZONES,
  type ObjectSource,
} from './plan-source';

/** Id of the demo document. Fixed, so the file does not change between runs. */
const PLAN_ID = 'plan_demo_ops_synthetic';
const PLAN_NAME = 'Демо-ОПС «Синтетическое» — учебное отделение';
const BASE_LAYER = 'l_base';

/** The one object the recommendation adds; the editor would name it this way. */
const NEW_BENCH_ID = 'eq_54';
const NEW_BENCH_LABEL = 'Скамья ожидания 2';
const NEW_BENCH_ATTRIBUTES = { inventoryNumber: 'ИНВ-ДЕМО-054', seats: 3 } as const;
/** The information display our own rule calls one too many. */
const EXCESS_DISPLAY_ID = 'eq_8';
/** The queue terminal standing too far from the entrance. */
const QUEUE_TERMINAL_ID = 'eq_1';

function fail(what: string, issues: Issue[]): never {
  const detail = issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n  ');
  throw new Error(`${what}\n  ${detail}`);
}

/**
 * Root of the repository: this file's own directory when it runs as a script,
 * the working directory under the test runner, which has no file urls.
 */
function repoRoot(): string {
  // Not `new URL('..', import.meta.url)`: Vite treats that exact pattern as an
  // asset reference and rewrites it to an http url, so under the test runner it
  // stops being a path at all. A plain fileURLToPath is left alone.
  if (!import.meta.url.startsWith('file:')) return process.cwd();
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function catalogFile(name: string): unknown {
  return JSON.parse(
    readFileSync(join(repoRoot(), 'data', 'catalog', `${name}.json`), 'utf8'),
  ) as unknown;
}

/** The catalog of the plan is the team catalog, checked before it is embedded. */
export function loadCatalog(): Catalog {
  const parsed = parseCatalog({
    version: '1.0.0',
    objectTypes: catalogFile('object-types'),
    zoneTypes: catalogFile('zone-types'),
    layerTypes: catalogFile('layer-types'),
    rules: catalogFile('rules'),
  });
  if (!parsed.ok) fail('Справочник data/catalog не разобрался', parsed.issues);
  return parsed.value;
}

/** One ordinary layer plus one overlay per informational type, as in the app. */
function layersOf(catalog: Catalog): Layer[] {
  const base: Layer = {
    id: BASE_LAYER,
    name: 'Основной',
    visible: true,
    locked: false,
    order: 0,
    typeId: null,
  };
  return [
    base,
    ...catalog.layerTypes.map((type, index) => ({
      id: `l_${type.id}`,
      name: type.label,
      visible: false,
      locked: false,
      order: index + 1,
      typeId: type.id,
    })),
  ];
}

/** The empty office: outline, walls, openings, layers. Nothing placed yet. */
function emptyPlan(catalog: Catalog): PlanDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: PLAN_ID,
    name: PLAN_NAME,
    room: { id: 'room_main', boundary: ROOM_BOUNDARY, ceilingHeight_m: CEILING_M },
    walls: WALLS.map((wall) => ({
      id: wall.id,
      from: wall.from,
      to: wall.to,
      thickness_m: WALL_M,
      height_m: CEILING_M,
    })),
    openings: OPENINGS.map((opening) => ({ ...opening })),
    layers: layersOf(catalog),
    zones: [],
    objects: [],
    catalog,
    extensions: {},
  };
}

function typeOf(catalog: Catalog, typeId: Id): ObjectType {
  const type = findObjectType(catalog, typeId);
  if (type === null) throw new Error(`Тип «${typeId}» отсутствует в справочнике`);
  return type;
}

/**
 * An object as the editor creates it: size, height and base come from the
 * catalog, `zoneId` is left to `relations.reconcile`.
 */
function objectOf(catalog: Catalog, source: ObjectSource): Equipment {
  const type = typeOf(catalog, source.typeId);
  return {
    id: source.id,
    typeId: type.id,
    label: source.label,
    position: source.position,
    size_m: [type.defaultSize_m[0], type.defaultSize_m[1]],
    rotation_deg: source.rotation_deg,
    base_m: type.defaultBase_m,
    height_m: type.defaultHeight_m,
    zoneId: null,
    layerId: BASE_LAYER,
    attributes: { ...source.attributes },
  };
}

function step(plan: PlanDocument, command: Parameters<typeof applyCommand>[1]): PlanDocument {
  const result = applyCommand(plan, command);
  if (!result.ok) fail(`Команда ${command.type} отклонена`, result.issues);
  return result.value;
}

/** The original plan of the submission. */
export function buildBefore(catalog: Catalog): PlanDocument {
  let plan = emptyPlan(catalog);
  for (const zone of ZONES) {
    plan = step(plan, {
      type: 'zone.put',
      zone: {
        id: zone.id,
        typeId: zone.typeId,
        name: zone.name,
        polygon: zone.polygon,
        parentId: zone.parentId,
        layerId: BASE_LAYER,
        attributes: { ...zone.attributes },
      },
    });
  }
  for (const source of OBJECTS) {
    plan = step(plan, { type: 'object.put', object: objectOf(catalog, source) });
  }
  // The links are recomputed, never declared: every object gets the deepest
  // zone that contains its whole footprint.
  return step(plan, { type: 'relations.reconcile' });
}

function objectById(plan: PlanDocument, id: Id): Equipment {
  const object = plan.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`В плане нет объекта «${id}»`);
  return object;
}

function advise(plan: PlanDocument, request: AdviceRequest): Recommendation[] {
  const result = calculateAdvice(plan, request);
  if (!result.ok) fail('Расчёт рекомендации не выполнен', result.issues);
  return result.value;
}

function one(recommendations: Recommendation[], id: Id): Recommendation {
  const found = recommendations.find((entry) => entry.id === id);
  if (found === undefined) {
    const have = recommendations.map((entry) => entry.id).join(', ');
    throw new Error(`Ожидалась рекомендация «${id}», получены: ${have || '—'}`);
  }
  return found;
}

function firstCandidate(recommendation: Recommendation): Equipment {
  const candidate = recommendation.candidates[0];
  if (candidate === undefined) {
    throw new Error(`Рекомендация «${recommendation.id}» не нашла ни одного места`);
  }
  return candidate.object;
}

/** Requests the demo asks the assistant, in the order the README shows them. */
export const REQUESTS = {
  equipment: { scenario: 'equipment', zoneId: null },
  // The anchor is the point a person clicks in the zone before asking. Next to
  // the bench that is already there for the second bench; beside the door, not
  // in it, for the terminal — the search checks geometry, not passageways.
  bench: { scenario: 'place', typeId: 'ot_bench', zoneId: 'z_waiting', anchor: [2.2, 2] },
  terminal: {
    scenario: 'place',
    typeId: 'ot_queue_terminal',
    zoneId: 'z_entrance',
    anchor: [7.9, 2.1],
  },
} as const satisfies Record<string, AdviceRequest>;

export type DemoBuild = {
  before: PlanDocument;
  after: PlanDocument;
  recommendation: DemoRecommendationFile;
  beforeText: string;
  afterText: string;
  recommendationText: string;
};

/** Who explained the recommendation when the model did. */
export type DemoLlmInfo = {
  provider: string;
  /** `LLM_MODEL` with the cloud folder id masked, see `publicModelName`. */
  model: string;
  /** Build date, Moscow time, YYYY-MM-DD. */
  date: string;
};

/** What `demo/recommendation.json` holds, on top of the assistant's own shape. */
export type DemoRecommendationFile = {
  note: string;
  mode: AdviceMode;
  /** Why the model was not used; null exactly when `mode` is 'llm'. */
  fallbackReason: string | null;
  /** Provider, model and date; null exactly when `mode` is 'fallback'. */
  llm: DemoLlmInfo | null;
  generatedBy: string;
  planId: Id;
  requests: AdviceRequest[];
  recommendations: Recommendation[];
  explanations: Explanation[];
  /**
   * Rendered Russian sentence per recommendation id. Templates write the words
   * in both modes; in 'llm' the model chose the reason, candidate and facts.
   */
  texts: Record<Id, string>;
  /** How each recommendation was applied to get `after.json`. */
  applied: {
    recommendationId: Id;
    candidateId: Id | null;
    action: 'object.put' | 'object.delete';
    objectId: Id;
    description: string;
  }[];
  effect: {
    metric: string;
    unit: string;
    before: number;
    after: number;
    delta: number;
  }[];
};

/**
 * The explanation of every recommendation: the model's verified choice when
 * `chosen` is given, the calculation's own default otherwise.
 */
function explanationsOf(
  recommendations: Recommendation[],
  chosen: Explanation[] | null,
): {
  explanations: Explanation[];
  texts: Record<Id, string>;
} {
  const explanations: Explanation[] = [];
  const texts: Record<Id, string> = {};
  for (const recommendation of recommendations) {
    const explanation =
      chosen === null
        ? defaultExplanation(recommendation)
        : (chosen.find((entry) => entry.recommendationId === recommendation.id) ?? null);
    if (explanation === null) {
      throw new Error(`Рекомендация «${recommendation.id}» без объяснения расчёта`);
    }
    const text = renderExplanation(recommendation, explanation);
    if (text === null) {
      throw new Error(`Объяснение «${recommendation.id}» не отрисовалось`);
    }
    explanations.push(explanation);
    texts[recommendation.id] = text;
  }
  return { explanations, texts };
}

function measured(plan: PlanDocument): { free: number; occupied: number; total: number } {
  const result = measurePlan(plan);
  if (!result.ok) fail('Площади плана не считаются', result.issues);
  const room = result.value.room;
  return { free: room.free_m2, occupied: room.occupied_m2, total: room.total_m2 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The two counts the applied rules are about, taken with the same scope the
 * rules use: `direct` ignores nested zones, `inclusive` counts them.
 */
function benchesInWaiting(plan: PlanDocument): number {
  return countInZoneScope(plan, 'ot_bench', 'z_waiting', 'direct');
}

function displaysInClient(plan: PlanDocument): number {
  return countInZoneScope(plan, 'ot_info_display', 'z_client', 'inclusive');
}

/**
 * How far an object stands from the centre of the entrance — the distance the
 * organizers' rule for the queue terminal is measured with, taken from the same
 * geometry function the check uses.
 */
function entranceDistance(plan: PlanDocument, objectId: Id): number {
  const opening = plan.openings.find((entry) => entry.kind === 'entrance');
  const wall = plan.walls.find((entry) => entry.id === opening?.wallId);
  if (opening === undefined || wall === undefined) {
    throw new Error('В плане нет входа: правило расстояния не проверить');
  }
  const centre = openingCentre(opening, wall);
  const object = objectById(plan, objectId);
  return Math.hypot(object.position[0] - centre[0], object.position[1] - centre[1]);
}

function severityCount(plan: PlanDocument, severity: Issue['severity']): number {
  return validatePlan(plan).filter((issue) => issue.severity === severity).length;
}

/** Everything the code calculates; the explanation is added on top. */
export type DemoCalculation = {
  before: PlanDocument;
  after: PlanDocument;
  /** The four requests sent to the assistant, with the plan each is about. */
  asked: { plan: PlanDocument; request: AdviceRequest }[];
  recommendations: Recommendation[];
  applied: DemoRecommendationFile['applied'];
  effect: DemoRecommendationFile['effect'];
};

/** The submission set without explanations: plans, recommendations, effect. */
export function calculateDemo(): DemoCalculation {
  const catalog = loadCatalog();
  const before = buildBefore(catalog);

  const equipment = advise(before, REQUESTS.equipment);
  const benchPlace = one(
    advise(before, REQUESTS.bench),
    'adv_place_ot_bench_z_waiting',
  );
  const terminalPlace = one(
    advise(before, REQUESTS.terminal),
    'adv_place_ot_queue_terminal_z_entrance',
  );
  const missingBench = one(equipment, 'adv_rule_bench_min_z_waiting_missing');
  const excessDisplay = one(equipment, 'adv_rule_info_display_max_z_client_excess');

  // Applying the recommendation by hand, in the order a person does it in the
  // editor: place the bench (it takes the next free id), delete the extra
  // display, then drag the queue terminal to the offered spot.
  const benchSpot = firstCandidate(benchPlace);
  const terminalSpot = firstCandidate(terminalPlace);
  const oldTerminal = objectById(before, QUEUE_TERMINAL_ID);

  let after = step(before, {
    type: 'object.put',
    object: {
      ...benchSpot,
      id: NEW_BENCH_ID,
      label: NEW_BENCH_LABEL,
      attributes: { ...NEW_BENCH_ATTRIBUTES },
    },
  });
  after = step(after, { type: 'object.delete', id: EXCESS_DISPLAY_ID });
  after = step(after, {
    type: 'object.put',
    object: {
      ...oldTerminal,
      position: terminalSpot.position,
      rotation_deg: terminalSpot.rotation_deg,
    },
  });
  after = step(after, { type: 'relations.reconcile' });

  const compare = one(advise(after, { scenario: 'compare', before }), 'adv_compare');

  const recommendations = [missingBench, excessDisplay, benchPlace, terminalPlace, compare];

  const areaBefore = measured(before);
  const areaAfter = measured(after);
  const inventoryBefore = buildInventory(before);
  const inventoryAfter = buildInventory(after);

  const effect: DemoRecommendationFile['effect'] = [
    {
      metric: 'area.free',
      unit: 'm2',
      before: round2(areaBefore.free),
      after: round2(areaAfter.free),
      delta: round2(areaAfter.free - areaBefore.free),
    },
    {
      metric: 'area.occupied',
      unit: 'm2',
      before: round2(areaBefore.occupied),
      after: round2(areaAfter.occupied),
      delta: round2(areaAfter.occupied - areaBefore.occupied),
    },
    {
      metric: 'equipment.count',
      unit: 'count',
      before: inventoryBefore.rows.length,
      after: inventoryAfter.rows.length,
      delta: inventoryAfter.rows.length - inventoryBefore.rows.length,
    },
    {
      metric: 'bench.in.waiting',
      unit: 'count',
      before: benchesInWaiting(before),
      after: benchesInWaiting(after),
      delta: benchesInWaiting(after) - benchesInWaiting(before),
    },
    {
      metric: 'display.in.client',
      unit: 'count',
      before: displaysInClient(before),
      after: displaysInClient(after),
      delta: displaysInClient(after) - displaysInClient(before),
    },
    {
      metric: 'entrance.distance',
      unit: 'm',
      before: round2(entranceDistance(before, QUEUE_TERMINAL_ID)),
      after: round2(entranceDistance(after, QUEUE_TERMINAL_ID)),
      delta: round2(
        entranceDistance(after, QUEUE_TERMINAL_ID) -
          entranceDistance(before, QUEUE_TERMINAL_ID),
      ),
    },
    {
      metric: 'issues.error',
      unit: 'count',
      before: severityCount(before, 'error'),
      after: severityCount(after, 'error'),
      delta: severityCount(after, 'error') - severityCount(before, 'error'),
    },
    {
      metric: 'issues.warning',
      unit: 'count',
      before: severityCount(before, 'warning'),
      after: severityCount(after, 'warning'),
      delta: severityCount(after, 'warning') - severityCount(before, 'warning'),
    },
  ];

  return {
    before,
    after,
    asked: [
      { plan: before, request: REQUESTS.equipment },
      { plan: before, request: REQUESTS.bench },
      { plan: before, request: REQUESTS.terminal },
      { plan: after, request: { scenario: 'compare', before } },
    ],
    recommendations,
    applied: [
      {
        recommendationId: benchPlace.id,
        candidateId: benchSpot.id,
        action: 'object.put',
        objectId: NEW_BENCH_ID,
        description:
          `Вторая скамья поставлена в найденную точку [${benchSpot.position.join(', ')}], ` +
          `поворот ${benchSpot.rotation_deg}°; редактор присвоил ей следующий свободный id ${NEW_BENCH_ID}, ` +
          'название и атрибуты заполнены в карточке свойств.',
      },
      {
        recommendationId: excessDisplay.id,
        candidateId: null,
        action: 'object.delete',
        objectId: EXCESS_DISPLAY_ID,
        description:
          `Лишнее информационное табло ${EXCESS_DISPLAY_ID} удалено: правило команды разрешает ` +
          'одно табло на клиентскую зону вместе с вложенными.',
      },
      {
        recommendationId: terminalPlace.id,
        candidateId: terminalSpot.id,
        action: 'object.put',
        objectId: QUEUE_TERMINAL_ID,
        description:
          `Существующий терминал очереди ${QUEUE_TERMINAL_ID} перенесён в найденную точку ` +
          `[${terminalSpot.position.join(', ')}] во входной группе; id, название и атрибуты сохранены, ` +
          'новый объект не создавался.',
      },
    ],
    effect,
  };
}

/** How the recommendation got its explanation. */
export type DemoExplanationOutcome =
  | { mode: 'fallback'; reason: string }
  | { mode: 'llm'; llm: DemoLlmInfo; explanations: Explanation[] };

/**
 * The reason written when no provider is configured. It states what the
 * builder saw, not a story about keys: the committed set is built this way.
 */
export const NO_PROVIDER_REASON =
  'При сборке комплекта провайдер LLM в окружении не был настроен (нужны LLM_ENDPOINT, ' +
  'LLM_MODEL и LLM_API_KEY, см. .env.example), поэтому использован обязательный режим ' +
  'без модели (D-016): показан расчёт с шаблонным объяснением.';

const NOTE_FALLBACK =
  'Рекомендация получена расчётом ассистента (src/domain/advice) без обращения к LLM. ' +
  'Числа посчитал код, тексты собраны из шаблонов справочника объяснений.';

const NOTE_LLM =
  'Рекомендация получена расчётом ассистента (src/domain/advice); объяснение — код причины, ' +
  'вариант размещения и факты — выбрала модель через маршрут /api/advice, и выбор прошёл ' +
  'проверку кодом (verifyExplanation). Числа посчитал код, модель их не меняла; тексты ' +
  'собраны из шаблонов справочника объяснений по выбору модели.';

/** Adds the explanation to the calculation and encodes the three files. */
export function assembleDemo(
  calculation: DemoCalculation,
  outcome: DemoExplanationOutcome,
): DemoBuild {
  const { before, after, recommendations } = calculation;
  const { explanations, texts } = explanationsOf(
    recommendations,
    outcome.mode === 'llm' ? outcome.explanations : null,
  );

  const recommendation: DemoRecommendationFile = {
    note: outcome.mode === 'llm' ? NOTE_LLM : NOTE_FALLBACK,
    mode: outcome.mode,
    fallbackReason: outcome.mode === 'fallback' ? outcome.reason : null,
    llm: outcome.mode === 'llm' ? outcome.llm : null,
    generatedBy: 'npx tsx demo/build.ts',
    planId: PLAN_ID,
    requests: [REQUESTS.equipment, REQUESTS.bench, REQUESTS.terminal],
    recommendations,
    explanations,
    texts,
    applied: calculation.applied,
    effect: calculation.effect,
  };

  const beforeEncoded = encodePlan(before);
  if (!beforeEncoded.ok) fail('before.json не записывается', beforeEncoded.issues);
  const afterEncoded = encodePlan(after);
  if (!afterEncoded.ok) fail('after.json не записывается', afterEncoded.issues);

  return {
    before,
    after,
    recommendation,
    beforeText: beforeEncoded.value,
    afterText: afterEncoded.value,
    recommendationText: `${JSON.stringify(recommendation, null, 2)}\n`,
  };
}

/** The whole submission set without a model: the committed, deterministic build. */
export function buildDemo(): DemoBuild {
  return assembleDemo(calculateDemo(), { mode: 'fallback', reason: NO_PROVIDER_REASON });
}

/**
 * Rebuilds a stored `recommendation.json` from the calculation, keeping only
 * what the calculation cannot reproduce: the fallback reason, or the model's
 * verified choice with provider, model and date. Byte equality with the file
 * then proves every number and id in it is the code's.
 */
export function rebuildFromFile(file: DemoRecommendationFile): DemoBuild {
  const outcome: DemoExplanationOutcome =
    file.mode === 'llm' && file.llm !== null
      ? { mode: 'llm', llm: file.llm, explanations: file.explanations }
      : { mode: 'fallback', reason: file.fallbackReason ?? '' };
  return assembleDemo(calculateDemo(), outcome);
}

/**
 * The model name as it may be published. Yandex AI Studio names carry the
 * cloud folder id (`gpt://<folder>/<model>`, likewise for its other schemes);
 * the team keeps that id out of the repository, so the set shows the model and
 * hides the folder of any `<scheme>://<folder>/` name.
 */
export function publicModelName(model: string): string {
  return model.replace(/^([a-z]+):\/\/[^/]+\//, '$1://<folder_ID>/');
}

/** YYYY-MM-DD in Moscow time: the team counts dates by МСК. */
function moscowDate(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(now);
}

type ModelAnswer = { ok: true; explanations: Explanation[] } | { ok: false; reason: string };
type RouteAnswer = { ok: true; response: AdviceResponse } | { ok: false; reason: string };

function looksLikeAdviceResponse(value: unknown): value is AdviceResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<AdviceResponse>;
  return (
    Number.isInteger(candidate.revision) &&
    Array.isArray(candidate.recommendations) &&
    Array.isArray(candidate.explanations) &&
    (candidate.mode === 'llm' || candidate.mode === 'fallback')
  );
}

/**
 * The in-process route is still an HTTP boundary: a plugin or future handler
 * can answer with an error page or malformed JSON. The demo build must record
 * fallback with a useful reason instead of throwing and leaving no ZIP.
 */
export function readAdviceRouteResponse(
  scenario: AdviceRequest['scenario'],
  label: string,
  reply: { statusCode: number; payload: string },
): RouteAnswer {
  const prefix = `Сценарий «${scenario}», ${label}`;
  if (reply.statusCode < 200 || reply.statusCode >= 300) {
    return {
      ok: false,
      reason: `${prefix}: маршрут ассистента ответил HTTP ${reply.statusCode}; показан расчёт.`,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(reply.payload) as unknown;
  } catch {
    return {
      ok: false,
      reason: `${prefix}: маршрут ассистента вернул не JSON; показан расчёт.`,
    };
  }
  if (!looksLikeAdviceResponse(body)) {
    return {
      ok: false,
      reason: `${prefix}: ответ маршрута ассистента не соответствует контракту; показан расчёт.`,
    };
  }
  return { ok: true, response: body };
}

/**
 * Turns the route's answers into the set's explanations, or the reason why
 * not. All or nothing: a set half explained by the model would need a mode per
 * line. The route already verified each answer against its own calculation;
 * here the choice is verified again against the builder's recommendations —
 * the ones written to the file — so a divergence between the two calculations
 * cannot slip a foreign fact into the set. The model may only explain the
 * variant that was applied: `after.json` and effect.md are built from the
 * applied candidate, and a text about another spot would contradict them.
 */
export function collectModelExplanations(
  recommendations: Recommendation[],
  applied: DemoRecommendationFile['applied'],
  answers: { scenario: AdviceRequest['scenario']; response: AdviceResponse }[],
  label: string,
): ModelAnswer {
  const explained: Explanation[] = [];
  for (const { scenario, response } of answers) {
    if (response.mode !== 'llm') {
      return {
        ok: false,
        reason: `Сценарий «${scenario}», ${label}: ${response.fallbackReason ?? 'модель не дала объяснения'}`,
      };
    }
    explained.push(
      ...response.explanations.filter((explanation) =>
        recommendations.some((entry) => entry.id === explanation.recommendationId),
      ),
    );
  }

  const missing = recommendations.filter(
    (entry) => !explained.some((explanation) => explanation.recommendationId === entry.id),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Модель не объяснила рекомендации ${missing.map((entry) => entry.id).join(', ')} (${label}): показан расчёт.`,
    };
  }
  const verified = verifyExplanation({ explanations: explained }, recommendations);
  if (!verified.ok) {
    return {
      ok: false,
      reason: `Ответ модели не прошёл проверку комплекта (${verified.issues.map((entry) => entry.code).join(', ')}), ${label}: показан расчёт.`,
    };
  }
  const otherVariant = applied.find((entry) => {
    if (entry.candidateId === null) return false;
    const explanation = verified.value.find(
      (item) => item.recommendationId === entry.recommendationId,
    );
    return explanation?.candidateId !== entry.candidateId;
  });
  if (otherVariant !== undefined) {
    const chosen = verified.value.find(
      (item) => item.recommendationId === otherVariant.recommendationId,
    );
    return {
      ok: false,
      reason: `Модель выбрала другой вариант, чем применён в after.json: для «${otherVariant.recommendationId}» — ${chosen?.candidateId ?? 'без варианта'} вместо ${otherVariant.candidateId} (${label}): показан расчёт.`,
    };
  }
  const unrendered = recommendations.find((recommendation) => {
    const explanation = verified.value.find((entry) => entry.recommendationId === recommendation.id);
    return explanation === undefined || renderExplanation(recommendation, explanation) === null;
  });
  if (unrendered !== undefined) {
    return {
      ok: false,
      reason: `Объяснение модели для «${unrendered.id}» не собирается в текст (${label}): показан расчёт.`,
    };
  }
  return { ok: true, explanations: verified.value };
}

/** Asks the model through the route the app uses, one call per request. */
async function askModel(calculation: DemoCalculation, config: LlmConfig): Promise<ModelAnswer> {
  const label = `${config.provider}/${publicModelName(config.model)}`;
  const app = Fastify({ logger: false, bodyLimit: LIMITS.maxRequestBytes });
  registerAdviceRoutes(app, {
    llm: createLlmClient(config),
    llmLabel: label,
    llmProvider: config.provider,
    // Four calls per build; the server's limit protects a public demo, not this.
    rateLimit: { max: calculation.asked.length, windowMs: 60_000 },
  });

  const answers: { scenario: AdviceRequest['scenario']; response: AdviceResponse }[] = [];
  try {
    for (const [index, { plan, request }] of calculation.asked.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/advice',
        payload: { plan, revision: index, request },
      });
      const parsed = readAdviceRouteResponse(request.scenario, label, response);
      if (!parsed.ok) return parsed;
      answers.push({ scenario: request.scenario, response: parsed.response });
    }
  } finally {
    await app.close();
  }
  return collectModelExplanations(
    calculation.recommendations,
    calculation.applied,
    answers,
    label,
  );
}

/**
 * The submission set with the provider from `env` — the same `LLM_*`
 * variables the server reads. Never throws on the model's account: any failure
 * becomes `mode: 'fallback'` with the reason.
 */
export async function buildDemoFromEnv(env: Env, now: Date = new Date()): Promise<DemoBuild> {
  const calculation = calculateDemo();
  const config = readLlmConfig(env);
  if (config === null) {
    return assembleDemo(calculation, { mode: 'fallback', reason: NO_PROVIDER_REASON });
  }
  const answer = await askModel(calculation, config);
  if (!answer.ok) return assembleDemo(calculation, { mode: 'fallback', reason: answer.reason });
  return assembleDemo(calculation, {
    mode: 'llm',
    llm: {
      provider: config.provider,
      model: publicModelName(config.model),
      date: moscowDate(now),
    },
    explanations: answer.explanations,
  });
}

const MODE_START = '<!-- demo-build:mode -->';
const MODE_END = '<!-- /demo-build:mode -->';

/** Markdown line width of the generated paragraph, as the rest of effect.md. */
const EFFECT_WIDTH = 84;

/** Greedy word wrap; a word longer than the width stays on its own line. */
function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((entry) => entry.length > 0)) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join('\n');
}

/** The effect.md paragraph about the mode, written from the file, not by hand. */
export function renderModeSection(file: DemoRecommendationFile): string {
  if (file.mode === 'llm' && file.llm !== null) {
    return wrap(
      `Объяснение выбрала **модель** (режим \`llm\`): провайдер \`${file.llm.provider}\`, ` +
        `модель \`${file.llm.model}\`, сборка комплекта ${file.llm.date}. Модель получила уже ` +
        'посчитанные рекомендации и выбрала для каждой код причины, вариант размещения и ' +
        'факты; выбор прошёл проверку кодом (`verifyExplanation`: `id` существуют, коды ' +
        'причин и факты взяты из расчёта; вариант — тот, что применён в `after.json`). ' +
        'Числа посчитал код, модель их не меняла. Полные структуры — в `recommendation.json`.',
      EFFECT_WIDTH,
    );
  }
  return wrap(
    'Ассистент работал **без LLM** (режим `fallback`). Причина, записанная сборщиком: ' +
      `${file.fallbackReason ?? 'не указана'} Это штатный режим, а не отказ: структура ` +
      'рекомендации и все числа от режима не меняются. Полные структуры — в ' +
      '`recommendation.json`.',
    EFFECT_WIDTH,
  );
}

/** Replaces the generated paragraph between the markers of effect.md. */
export function withModeSection(markdown: string, section: string): string {
  const start = markdown.indexOf(MODE_START);
  const end = markdown.indexOf(MODE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`В effect.md нет меток ${MODE_START} … ${MODE_END}`);
  }
  return `${markdown.slice(0, start + MODE_START.length)}\n${section}\n${markdown.slice(end)}`;
}

function report(build: DemoBuild): string {
  const lines: string[] = [];
  const errors = validatePlan(build.before).filter((issue) => issue.severity === 'error');
  const warnings = validatePlan(build.before).filter((issue) => issue.severity === 'warning');
  lines.push(`Объектов: ${build.before.objects.length} → ${build.after.objects.length}`);
  lines.push(`Зон: ${build.before.zones.length}`);
  lines.push(`Ошибок в before: ${errors.length}, предупреждений: ${warnings.length}`);
  for (const issue of [...errors, ...warnings]) {
    lines.push(`  ${issue.severity} ${issue.code}: ${issue.message}`);
  }
  for (const issue of validatePlan(build.after)) {
    lines.push(`  after ${issue.severity} ${issue.code}: ${issue.message}`);
  }
  for (const row of build.recommendation.effect) {
    lines.push(`  ${row.metric}: ${row.before} → ${row.after} (${row.delta}) ${row.unit}`);
  }
  for (const [id, text] of Object.entries(build.recommendation.texts)) {
    lines.push(`  ${id}: ${text}`);
  }
  return lines.join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const build = await buildDemoFromEnv(process.env);
  const demoDir = join(repoRoot(), 'demo');
  const effectFile = join(demoDir, 'effect.md');
  const effect = withModeSection(
    readFileSync(effectFile, 'utf8'),
    renderModeSection(build.recommendation),
  );
  writeFileSync(join(demoDir, 'before.json'), build.beforeText, 'utf8');
  writeFileSync(join(demoDir, 'after.json'), build.afterText, 'utf8');
  writeFileSync(join(demoDir, 'recommendation.json'), build.recommendationText, 'utf8');
  writeFileSync(effectFile, effect, 'utf8');
  process.stdout.write(`${report(build)}\n`);
  process.stdout.write(
    'Записаны demo/before.json, demo/after.json, demo/recommendation.json, demo/effect.md\n',
  );
  const file = build.recommendation;
  if (file.mode === 'llm') {
    process.stdout.write(`Режим: llm — ${file.llm?.provider} / ${file.llm?.model}, ${file.llm?.date}\n`);
  } else {
    process.stdout.write(`Режим: fallback — ${file.fallbackReason}\n`);
    // A configured provider that still gave fallback is worth a red exit code:
    // the files are honest, but the person asked for the model.
    if (readLlmConfig(process.env) !== null) process.exitCode = 1;
  }
}
