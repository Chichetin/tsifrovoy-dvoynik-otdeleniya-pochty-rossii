/**
 * A02 acceptance: the rule lives in the catalog, not in the code.
 *
 * The test that matters most is `правило меняется только в JSON`: the same plan
 * is checked twice against two different rule sets and gives two different
 * answers, with nothing in `equipment.ts` touched. A recommendation that could
 * only be produced by a hard-coded branch would not survive it.
 *
 * The last test pins the other half of the promise: the recommendation and the
 * check that draws the violation on the plan must quote the same number.
 */

import { describe, expect, test } from 'vitest';
import type {
  Catalog,
  CountRule,
  Equipment,
  PlanDocument,
  Point,
  Polygon,
  Rule,
  Zone,
} from '../../contracts/model';
import { SCHEMA_VERSION } from '../../contracts/model';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import { METRIC_UNITS } from '../../contracts/advice-semantics';
import { validatePlan } from '../validation';
import { checkEquipment } from './equipment';

const BENCH = {
  id: 'ot_bench',
  label: 'Место ожидания',
  category: 'Клиентский зал',
  defaultSize_m: [1.6, 0.5] as Point,
  defaultHeight_m: 0.45,
  defaultBase_m: 0,
  physical: true,
  occupiesFloor: true,
  symbol: 'rect' as const,
  color: '#4C6EF5',
  provenance: 'Допущение команды: условный размер для теста комплектования.',
  attributes: [],
};

const DISPLAY = { ...BENCH, id: 'ot_info_display', label: 'Информационное табло' };

function rule(overrides: Partial<CountRule> = {}): CountRule {
  return {
    id: 'rule_bench_min',
    source: 'team-assumption',
    rationale: 'Правило команды: в зоне ожидания не меньше двух мест ожидания.',
    kind: 'count',
    zoneTypeId: 'zt_waiting',
    objectTypeId: 'ot_bench',
    scope: 'direct',
    min: 2,
    max: null,
    ...overrides,
  };
}

function catalog(rules: Rule[]): Catalog {
  return {
    version: 'test-1',
    objectTypes: [BENCH, DISPLAY],
    zoneTypes: [
      { id: 'zt_client', label: 'Клиентская зона', color: '#E7F5FF', attributes: [] },
      { id: 'zt_waiting', label: 'Зона ожидания', color: '#FFF4E6', attributes: [] },
    ],
    layerTypes: [],
    rules,
  };
}

function zone(id: string, typeId: string, polygon: Polygon, parentId: string | null = null): Zone {
  return { id, typeId, name: id, polygon, parentId, layerId: 'l_base', attributes: {} };
}

function object(id: string, typeId: string, position: Point, zoneId: string | null): Equipment {
  return {
    id,
    typeId,
    label: id,
    position,
    size_m: [1.6, 0.5],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.45,
    zoneId,
    layerId: 'l_base',
    attributes: {},
  };
}

/** Клиентская зона 0…8 по X, внутри неё зона ожидания 0…4. */
function plan(rules: Rule[], objects: Equipment[]): PlanDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'plan_test',
    name: 'Тестовый план',
    room: { id: 'room_main', boundary: [[0, 0], [10, 0], [10, 8], [0, 8]], ceilingHeight_m: 3 },
    walls: [],
    openings: [],
    layers: [
      { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
    ],
    zones: [
      zone('z_client', 'zt_client', [[0, 0], [8, 0], [8, 8], [0, 8]]),
      zone('z_waiting', 'zt_waiting', [[0, 0], [4, 0], [4, 4], [0, 4]], 'z_client'),
    ],
    objects,
    catalog: catalog(rules),
    extensions: {},
  };
}

function check(document: PlanDocument, zoneId: string | null = null) {
  return checkEquipment(document, { scenario: 'equipment', zoneId });
}

describe('A02: недостающее и лишнее оборудование', () => {
  test('недостача: считает факт, норму и называет зону', () => {
    const document = plan([rule()], [object('eq_bench_1', 'ot_bench', [1, 1], 'z_waiting')]);

    const advice = check(document);

    expect(advice.length).toBe(1);
    expect(advice[0]).toMatchObject({
      scenario: 'equipment',
      reasonCodes: ['equipment.missing'],
      ruleIds: ['rule_bench_min'],
      candidates: [],
      changes: [],
    });
    expect(advice[0]?.facts.map((entry) => [entry.metric, entry.value])).toEqual([
      ['equipment.count', 1],
      ['equipment.min', 2],
    ]);
    expect(advice[0]?.refs).toEqual([
      { kind: 'zone', id: 'z_waiting' },
      { kind: 'object', id: 'eq_bench_1' },
    ]);
  });

  test('ровно норма и перебор нормы различаются', () => {
    const two = [
      object('eq_bench_1', 'ot_bench', [1, 1], 'z_waiting'),
      object('eq_bench_2', 'ot_bench', [3, 1], 'z_waiting'),
    ];

    expect(check(plan([rule()], two))).toEqual([]);

    const limit = rule({ id: 'rule_bench_max', min: null, max: 1 });
    const excess = check(plan([limit], two));

    expect(excess.length).toBe(1);
    expect(excess[0]?.reasonCodes).toEqual(['equipment.excess']);
    expect(excess[0]?.facts.map((entry) => [entry.metric, entry.value])).toEqual([
      ['equipment.count', 2],
      ['equipment.max', 1],
    ]);
  });

  test('правило меняется только в JSON: код не знает типов оборудования', () => {
    const objects = [object('eq_display_1', 'ot_info_display', [1, 1], 'z_waiting')];
    const forDisplays = rule({
      id: 'rule_display_min',
      objectTypeId: 'ot_info_display',
      min: 3,
      rationale: 'Правило команды: три табло в зоне ожидания.',
    });

    // Тот же план, тот же код: разницу делает только справочник правил.
    expect(check(plan([rule()], objects)).map((entry) => entry.ruleIds[0])).toEqual([
      'rule_bench_min',
    ]);
    expect(check(plan([forDisplays], objects)).map((entry) => entry.ruleIds[0])).toEqual([
      'rule_display_min',
    ]);
  });

  test('вложенная зона: inclusive видит объект ребёнка, direct — нет', () => {
    const objects = [object('eq_bench_1', 'ot_bench', [1, 1], 'z_waiting')];
    const forClient = rule({
      id: 'rule_client_bench',
      zoneTypeId: 'zt_client',
      scope: 'inclusive',
      min: 1,
    });

    expect(check(plan([forClient], objects))).toEqual([]);

    const direct = { ...forClient, scope: 'direct' as const };
    const advice = check(plan([direct], objects));

    expect(advice.length).toBe(1);
    expect(advice[0]?.facts[0]?.value).toBe(0);
    expect(advice[0]?.refs).toEqual([{ kind: 'zone', id: 'z_client' }]);
  });

  test('запрос по одной зоне не приносит находки соседних зон', () => {
    const document = plan(
      [rule(), rule({ id: 'rule_client_bench', zoneTypeId: 'zt_client', scope: 'direct', min: 1 })],
      [],
    );

    expect(check(document).map((entry) => entry.ruleIds[0])).toEqual([
      'rule_client_bench',
      'rule_bench_min',
    ]);
    expect(check(document, 'z_waiting').map((entry) => entry.ruleIds[0])).toEqual([
      'rule_bench_min',
    ]);
  });

  test('источник правила виден в тексте: допущение команды не выдаётся за норматив', () => {
    const team = check(plan([rule()], []))[0];
    const organizers = check(plan([rule({ source: 'organizer-material' })], []))[0];

    expect(team?.assumptions).toContain(
      'Источник правила: справочник проекта (rule_bench_min).',
    );
    expect(organizers?.assumptions).toContain(
      'Источник правила: материалы организаторов (rule_bench_min).',
    );
    expect(team?.limitations).toEqual([REASON_CODE_SPECS['equipment.missing'].requiredLimitation]);
  });

  test('факты согласованы со словарём объяснений и ссылаются на существующие сущности', () => {
    const document = plan([rule()], [object('eq_bench_1', 'ot_bench', [1, 1], 'z_waiting')]);

    const ids = new Set([
      document.room.id,
      ...document.zones.map((entry) => entry.id),
      ...document.objects.map((entry) => entry.id),
    ]);
    for (const advice of check(document)) {
      for (const ref of advice.refs) expect(ids.has(ref.id)).toBe(true);
      for (const entry of advice.facts) {
        expect(entry.unit).toBe(METRIC_UNITS[entry.metric]);
        expect(Number.isInteger(entry.value)).toBe(true);
        for (const ref of entry.refs) expect(ids.has(ref.id)).toBe(true);
      }
      expect(new Set(advice.facts.map((entry) => entry.id)).size).toBe(advice.facts.length);
      expect(REASON_CODE_SPECS[advice.reasonCodes[0] ?? 'equipment.missing'].scenarios).toContain(
        'equipment',
      );
    }
  });

  test('рекомендация и проверка корректности считают одно и то же число', () => {
    const document = plan([rule()], [object('eq_bench_1', 'ot_bench', [1, 1], 'z_waiting')]);

    const advice = check(document);
    const issues = validatePlan(document).filter(
      (entry) => entry.code === 'RULE_COUNT_BELOW_MIN',
    );

    expect(issues.length).toBe(advice.length);
    expect(issues[0]?.message).toContain(`${advice[0]?.facts[0]?.value} шт.`);
    expect(issues[0]?.refs[0]).toEqual(advice[0]?.refs[0]);
  });
});
