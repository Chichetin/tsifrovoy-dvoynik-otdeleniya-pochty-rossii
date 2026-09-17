/**
 * A03 acceptance: «было → стало» в числах, которые сойдутся с планом.
 *
 * Первый тест — случай из карточки пакета: объект 2×1 на свободном полу
 * забирает ровно 2 м² и добавляет одну единицу в перечень. Дальше проверяется
 * то, на чём такой расчёт обычно врёт: перенос без изменения площади,
 * пересечение объектов (его нельзя вычесть дважды) и диспетчер сценариев,
 * который обязан отдавать все три сценария условий одной формой ответа.
 */

import { describe, expect, test } from 'vitest';
import type {
  Catalog,
  Equipment,
  ObjectType,
  PlanDocument,
  Point,
  Polygon,
  Rule,
  Zone,
} from '../../contracts/model';
import { SCHEMA_VERSION } from '../../contracts/model';
import { METRIC_UNITS, REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import { calculateAdvice, comparePlans, diffPlans } from './index';

const DESK: ObjectType = {
  id: 'ot_desk',
  label: 'Стол',
  category: 'Обслуживание',
  defaultSize_m: [2, 1],
  defaultHeight_m: 0.75,
  defaultBase_m: 0,
  physical: true,
  occupiesFloor: true,
  symbol: 'rect',
  color: '#4C6EF5',
  provenance: 'Допущение команды: условный размер для теста сравнения.',
  attributes: [],
};

const catalog: Catalog = {
  version: 'test-1',
  objectTypes: [DESK],
  zoneTypes: [{ id: 'zt_client', label: 'Клиентская зона', color: '#E7F5FF', attributes: [] }],
  layerTypes: [],
  rules: [],
};

function object(id: string, position: Point, overrides: Partial<Equipment> = {}): Equipment {
  return {
    id,
    typeId: 'ot_desk',
    label: id,
    position,
    size_m: [2, 1],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.75,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...overrides,
  };
}

function zone(id: string, polygon: Polygon): Zone {
  return {
    id,
    typeId: 'zt_client',
    name: id,
    polygon,
    parentId: null,
    layerId: 'l_base',
    attributes: {},
  };
}

/** Помещение 10×8 = 80 м². */
function plan(objects: Equipment[], overrides: Partial<PlanDocument> = {}): PlanDocument {
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
    zones: [],
    objects,
    catalog,
    extensions: {},
    ...overrides,
  };
}

function only(before: PlanDocument, after: PlanDocument) {
  const result = comparePlans(before, after);
  if (!result.ok) throw new Error(`ожидался расчёт: ${JSON.stringify(result.issues)}`);
  const recommendation = result.value[0];
  if (recommendation === undefined) throw new Error('сравнение не вернуло рекомендацию');
  return recommendation;
}

function values(recommendation: { facts: { metric: string; phase: string; value: number }[] }) {
  return Object.fromEntries(
    recommendation.facts.map((fact) => [`${fact.metric}.${fact.phase}`, fact.value]),
  );
}

describe('A03: эффект изменения', () => {
  test('объект 2×1 на свободном полу: свободно −2 м², объектов +1', () => {
    const before = plan([]);
    const after = plan([object('eq_desk_1', [3, 3])]);

    const advice = only(before, after);

    expect(values(advice)).toMatchObject({
      'area.free.before': 80,
      'area.free.after': 78,
      'area.free.delta': -2,
      'area.occupied.delta': 2,
      'equipment.count.before': 0,
      'equipment.count.after': 1,
      'equipment.count.delta': 1,
      'objects.added.delta': 1,
      'objects.removed.delta': 0,
    });
    expect(advice.changes).toEqual([{ ref: { kind: 'object', id: 'eq_desk_1' }, kind: 'added' }]);
    expect(advice.reasonCodes).toEqual(['comparison.changed']);
  });

  test('перенос без изменения отпечатка: площадь и число прежние, перенос измерен', () => {
    const before = plan([object('eq_desk_1', [3, 3])]);
    const after = plan([object('eq_desk_1', [6, 3])]);

    const advice = only(before, after);

    expect(values(advice)).toMatchObject({
      'area.free.delta': 0,
      'equipment.count.delta': 0,
      'objects.added.delta': 0,
      'placement.distance.delta': 3,
    });
    expect(advice.changes).toEqual([{ ref: { kind: 'object', id: 'eq_desk_1' }, kind: 'moved' }]);
    // Дельта перемещения ненулевая, значит код «изменилось» допустим.
    expect(advice.reasonCodes).toEqual(['comparison.changed']);
  });

  test('пересечение объектов не вычитается дважды', () => {
    const before = plan([object('eq_desk_1', [3, 3])]);
    // Второй стол перекрывает первый наполовину: занято 2 + 1, а не 2 + 2.
    const after = plan([object('eq_desk_1', [3, 3]), object('eq_desk_2', [4, 3])]);

    expect(values(only(before, after))).toMatchObject({
      'area.occupied.before': 2,
      'area.occupied.after': 3,
      'area.free.after': 77,
    });
  });

  test('удаление и правка атрибута различаются в списке изменений', () => {
    const before = plan([object('eq_desk_1', [3, 3]), object('eq_desk_2', [6, 3])]);
    const after = plan([
      object('eq_desk_1', [3, 3], { attributes: { inventoryNumber: 'ОПС-1' } }),
    ]);

    const advice = only(before, after);

    expect(advice.changes).toEqual([
      { ref: { kind: 'object', id: 'eq_desk_1' }, kind: 'updated' },
      { ref: { kind: 'object', id: 'eq_desk_2' }, kind: 'removed' },
    ]);
    expect(values(advice)['objects.removed.delta']).toBe(1);
  });

  test('зоны и помещение попадают в список изменений', () => {
    const before = plan([], { zones: [zone('z_client', [[0, 0], [4, 0], [4, 4], [0, 4]])] });
    const after = plan([], {
      zones: [zone('z_client', [[0, 0], [5, 0], [5, 4], [0, 4]])],
      room: { id: 'room_main', boundary: [[0, 0], [12, 0], [12, 8], [0, 8]], ceilingHeight_m: 3 },
    });

    expect(diffPlans(before, after)).toEqual([
      { ref: { kind: 'zone', id: 'z_client' }, kind: 'updated' },
      { ref: { kind: 'room', id: 'room_main' }, kind: 'updated' },
    ]);
  });

  test('одинаковые снимки: «показатели не изменились» и пустой список', () => {
    const document = plan([object('eq_desk_1', [3, 3])]);

    const advice = only(document, plan([object('eq_desk_1', [3, 3])]));

    expect(advice.changes).toEqual([]);
    expect(advice.reasonCodes).toEqual(['comparison.unchanged']);
    expect(advice.limitations).toEqual([
      REASON_CODE_SPECS['comparison.unchanged'].requiredLimitation,
    ]);
    expect(document.objects.length).toBe(1);
  });

  test('правка, невидимая показателям, названа прямо и не выдана за отсутствие изменений', () => {
    const before = plan([object('eq_desk_1', [3, 3])]);
    const after = plan([object('eq_desk_1', [3, 3], { label: 'Стол оператора' })]);

    const advice = only(before, after);

    expect(advice.changes).toEqual([{ ref: { kind: 'object', id: 'eq_desk_1' }, kind: 'updated' }]);
    expect(advice.reasonCodes).toEqual(['comparison.unchanged']);
    expect(advice.limitations).toContain(
      'Различия между снимками есть, но на площади и число объектов они не влияют: они перечислены в списке изменений.',
    );
  });

  test('невычислимая геометрия одного из снимков — отказ, а не выдуманные числа', () => {
    const broken = plan([], {
      room: { id: 'room_main', boundary: [[0, 0], [10, 8], [10, 0], [0, 8]], ceilingHeight_m: 3 },
    });

    expect(comparePlans(plan([]), broken).ok).toBe(false);
    expect(comparePlans(broken, plan([])).ok).toBe(false);
  });
});

describe('A03: диспетчер сценариев', () => {
  test('три сценария условий отвечают одной формой', () => {
    const document = plan([object('eq_desk_1', [3, 3])]);

    const place = calculateAdvice(document, {
      scenario: 'place',
      typeId: 'ot_desk',
      zoneId: null,
    });
    const equipment = calculateAdvice(document, { scenario: 'equipment', zoneId: null });
    const compare = calculateAdvice(document, { scenario: 'compare', before: plan([]) });

    expect([place.ok, equipment.ok, compare.ok]).toEqual([true, true, true]);
    if (!place.ok || !equipment.ok || !compare.ok) return;
    expect(place.value[0]?.scenario).toBe('place');
    expect(compare.value[0]?.scenario).toBe('compare');
    // Правил в этом справочнике нет, значит и сказать о комплектовании нечего.
    expect(equipment.value).toEqual([]);
  });

  test('сценарий размещения несёт кандидатов, правила и способ перебора', () => {
    const rule: Rule = {
      id: 'rule_desk_min',
      source: 'team-assumption',
      rationale: 'Правило команды: в клиентской зоне хотя бы один стол.',
      kind: 'count',
      zoneTypeId: 'zt_client',
      objectTypeId: 'ot_desk',
      scope: 'inclusive',
      min: 1,
      max: null,
    };
    const document = plan([], { catalog: { ...catalog, rules: [rule] } });

    const result = calculateAdvice(document, {
      scenario: 'place',
      typeId: 'ot_desk',
      zoneId: null,
      anchor: [5, 4],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const advice = result.value[0];
    expect(advice?.reasonCodes).toEqual(['placement.available']);
    expect(advice?.candidates.length).toBeGreaterThan(0);
    expect(advice?.ruleIds).toEqual(['rule_desk_min']);
    expect(advice?.assumptions.join(' ')).toContain('Перебор: сетка 0.1 м');
    expect(advice?.assumptions.join(' ')).toContain('допущение команды');
    expect(advice?.limitations).toEqual([
      REASON_CODE_SPECS['placement.available'].requiredLimitation,
    ]);

    // Обязательные факты кода — и текущие, и прогнозные — лежат в рекомендации.
    for (const required of REASON_CODE_SPECS['placement.available'].requiredFacts) {
      expect(
        advice?.facts.some(
          (fact) => fact.metric === required.metric && fact.phase === required.phase,
        ),
      ).toBe(true);
    }
  });

  test('места нет — это ответ с кодом placement.none, а не пустая рекомендация', () => {
    const wall = object('eq_wall', [5, 4], { size_m: [10, 8], height_m: 2 });

    const result = calculateAdvice(plan([wall]), {
      scenario: 'place',
      typeId: 'ot_desk',
      zoneId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.reasonCodes).toEqual(['placement.none']);
    expect(result.value[0]?.candidates).toEqual([]);
    expect(result.value[0]?.limitations).toEqual([
      REASON_CODE_SPECS['placement.none'].requiredLimitation,
    ]);
  });

  test('факты любого сценария согласованы со словарём единиц и уникальны по id', () => {
    const document = plan([object('eq_desk_1', [3, 3])]);
    const requests = [
      { scenario: 'place', typeId: 'ot_desk', zoneId: null } as const,
      { scenario: 'compare', before: plan([]) } as const,
    ];

    for (const request of requests) {
      const result = calculateAdvice(document, request);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const advice of result.value) {
        expect(new Set(advice.facts.map((fact) => fact.id)).size).toBe(advice.facts.length);
        for (const fact of advice.facts) {
          expect(fact.unit).toBe(METRIC_UNITS[fact.metric]);
          expect(Number.isFinite(fact.value)).toBe(true);
        }
        expect(REASON_CODE_SPECS[advice.reasonCodes[0] ?? 'placement.none'].scenarios).toContain(
          advice.scenario,
        );
      }
    }
  });
});
