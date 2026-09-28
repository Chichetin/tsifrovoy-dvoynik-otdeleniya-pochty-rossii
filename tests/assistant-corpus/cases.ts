import { readFileSync } from 'node:fs';
import type { PlanDocument, Polygon } from '../../src/contracts/model';
import { parsePlanDocument } from '../../src/contracts/schema';

function load(file: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.ok) throw new Error(file);
  return parsed.value;
}
export const before = load('demo/before.json');
export const after = load('demo/after.json');

/** Third synthetic office: compact, unoccupied, with the same equipment catalog. */
function compactOffice(): PlanDocument {
  const plan = structuredClone(before);
  plan.id = 'plan_corpus_compact';
  plan.name = 'Синтетическое компактное отделение — тестовый корпус';
  plan.room.boundary = [[0, 0], [12, 0], [12, 8], [0, 8]];
  plan.walls = [];
  plan.openings = [];
  plan.objects = [];
  const polygons: Record<string, Polygon> = {
    z_client: [[0, 0], [8, 0], [8, 6], [0, 6]],
    z_back: [[8, 0], [12, 0], [12, 6], [8, 6]],
    z_storage: [[8, 6], [12, 6], [12, 8], [8, 8]],
    z_waiting: [[0, 6], [8, 6], [8, 8], [0, 8]],
  };
  plan.zones = plan.zones.filter((zone) => polygons[zone.id] !== undefined).map((zone) => ({ ...zone, parentId: null, polygon: polygons[zone.id]! }));
  const parsed = parsePlanDocument(plan);
  if (!parsed.ok) throw new Error('compact');
  return parsed.value;
}
export const compact = compactOffice();

export type CorpusCase = {
  id: string;
  category: 'place' | 'equipment' | 'compare' | 'refusal';
  plan: PlanDocument;
  before?: PlanDocument;
  query: string;
  tool: { name: string; args: Record<string, unknown> };
  /** Scripted incorrect text deliberately retries the same unsafe claim. */
  unsafeText?: string;
};
const plans = [{ name: 'before', plan: before }, { name: 'after', plan: after }, { name: 'compact', plan: compact }];
const types = [
  { id: 'ot_workplace', query: 'Где поставить дополнительное рабочее место?' },
  { id: 'ot_cashier_window', query: 'Где поставить ещё одно кассовое окно?' },
  { id: 'ot_parcel_rack', query: 'Где поставить дополнительный стеллаж для посылок?' },
];
const place: CorpusCase[] = plans.flatMap(({ name, plan }) => types.map((type) => ({
  id: `place-${name}-${type.id}`, category: 'place', plan, query: type.query, tool: { name: 'find_place', args: { typeId: type.id, zoneId: null } },
})));
const equipment: CorpusCase[] = plans.flatMap(({ name, plan }) => [null, 'z_waiting'].map((zoneId) => ({
  id: `equipment-${name}-${zoneId ?? 'all'}`, category: 'equipment', plan,
  query: zoneId === null ? 'Чего не хватает или что лишнее по оборудованию?' : 'Чего не хватает или что лишнее в зоне ожидания?',
  tool: { name: 'check_equipment', args: { zoneId } },
})));
const compare: CorpusCase[] = [
  { id: 'compare-before-after', category: 'compare', plan: after, before, query: 'Как изменились площадь и оборудование?', tool: { name: 'compare_with_original', args: {} } },
  { id: 'compare-unchanged', category: 'compare', plan: before, before, query: 'Что изменилось?', tool: { name: 'compare_with_original', args: {} } },
  { id: 'compare-after-before', category: 'compare', plan: before, before: after, query: 'Как изменилась свободная площадь после возврата к исходному?', tool: { name: 'compare_with_original', args: {} } },
];
const claims = [
  'Свободная площадь помещения — 132 м².',
  'Свободная площадь помещения — 99999 м².',
  'Свободная площадь помещения — сто тридцать два квадратных метра.',
  'Свободная площадь помещения — 114,73 метра.',
  'В комнате персонала свободно 114,73 м².',
  'Свободная площадь выросла на 0,8 м².',
];
const refusal: CorpusCase[] = claims.map((unsafeText, index) => ({
  id: `refusal-${index + 1}`, category: 'refusal', plan: index === 5 ? after : before, ...(index === 5 ? { before } : {}),
  query: `Проверь утверждение: ${unsafeText}`,
  tool: { name: index === 5 ? 'compare_with_original' : 'plan_overview', args: {} }, unsafeText,
}));
export const ASSISTANT_CORPUS: readonly CorpusCase[] = [...place, ...equipment, ...compare, ...refusal];
