/**
 * A01 acceptance: a candidate the user can accept without checking it by hand.
 *
 * Every test here asks the same question in a different shape — is the offered
 * spot really free? The strongest one is `не ломает план`: the candidate is put
 * into the document and run through `validatePlan`, the same check the editor
 * shows, so an offer that would create a collision or break an organizers' rule
 * cannot reach the user.
 */

import { describe, expect, test } from 'vitest';
import type {
  Catalog,
  Issue,
  Equipment,
  ObjectType,
  PlanDocument,
  Point,
  Polygon,
  Rule,
  Zone,
} from '../../contracts/model';
import { SCHEMA_VERSION } from '../../contracts/model';
import { contains, footprint } from '../geometry';
import { validatePlan } from '../validation';
import { PLACEMENT_ISSUE_CODES, PLACEMENT_SEARCH, findPlacements } from './placement';

const DESK: ObjectType = {
  id: 'ot_desk',
  label: 'Стол',
  category: 'Обслуживание',
  defaultSize_m: [1.4, 0.8],
  defaultHeight_m: 0.75,
  defaultBase_m: 0,
  physical: true,
  occupiesFloor: true,
  symbol: 'rect',
  color: '#4C6EF5',
  provenance: 'Допущение команды: условный размер для теста размещения.',
  attributes: [{ key: 'inventoryNumber', label: 'Инвентарный номер', type: 'string', required: false, default: '' }],
};

/** Big solid shape used to fence off parts of the room. */
const BLOCK: ObjectType = {
  ...DESK,
  id: 'ot_block',
  label: 'Блок',
  defaultSize_m: [1, 1],
  defaultHeight_m: 2,
  attributes: [],
};

/** Under the ceiling: solid, but never in the way of furniture. */
const CAMERA: ObjectType = {
  ...DESK,
  id: 'ot_camera',
  label: 'Камера',
  defaultSize_m: [0.15, 0.15],
  defaultHeight_m: 0.15,
  defaultBase_m: 2.6,
  occupiesFloor: false,
  attributes: [],
};

const TERMINAL: ObjectType = {
  ...DESK,
  id: 'ot_queue_terminal',
  label: 'Терминал очереди',
  defaultSize_m: [0.5, 0.5],
  defaultHeight_m: 1.4,
  attributes: [],
};

function catalog(rules: Rule[] = []): Catalog {
  return {
    version: 'test-1',
    objectTypes: [DESK, BLOCK, CAMERA, TERMINAL],
    zoneTypes: [
      { id: 'zt_client', label: 'Клиентская зона', color: '#E7F5FF', attributes: [] },
      { id: 'zt_service', label: 'Служебная зона', color: '#FFF4E6', attributes: [] },
    ],
    layerTypes: [],
    rules,
  };
}

function object(
  id: string,
  typeId: string,
  position: Point,
  size_m: Point,
  overrides: Partial<Equipment> = {},
): Equipment {
  return {
    id,
    typeId,
    label: id,
    position,
    size_m,
    rotation_deg: 0,
    base_m: 0,
    height_m: 2,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...overrides,
  };
}

function zone(id: string, typeId: string, polygon: Polygon, parentId: string | null = null): Zone {
  return { id, typeId, name: id, polygon, parentId, layerId: 'l_base', attributes: {} };
}

/** Room 10×8 with no walls unless a test adds them. */
function plan(overrides: Partial<PlanDocument> = {}): PlanDocument {
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
    objects: [],
    catalog: catalog(),
    extensions: {},
    ...overrides,
  };
}

function place(document: PlanDocument, typeId: string, zoneId: string | null, anchor?: Point) {
  const request =
    anchor === undefined
      ? ({ scenario: 'place', typeId, zoneId } as const)
      : ({ scenario: 'place', typeId, zoneId, anchor } as const);
  return findPlacements(document, request);
}

/** Errors are what a candidate must never add; warnings only rank it. */
function errors(issues: Issue[]): Issue[] {
  return issues.filter((entry) => entry.severity === 'error');
}

function values(document: PlanDocument, typeId: string, zoneId: string | null, anchor?: Point) {
  const result = place(document, typeId, zoneId, anchor);
  if (!result.ok) throw new Error(`ожидался результат, получены проблемы: ${JSON.stringify(result.issues)}`);
  return result.value;
}

describe('A01: поиск места', () => {
  test('кандидаты лежат в помещении и не задевают существующие объекты', () => {
    const document = plan({
      objects: [object('eq_block', 'ot_block', [5, 4], [2, 2])],
    });

    const candidates = values(document, 'ot_desk', null);

    expect(candidates.length).toBe(PLACEMENT_SEARCH.maxCandidates);
    const before = errors(validatePlan(document));
    for (const candidate of candidates) {
      expect(contains(document.room.boundary, footprint(candidate.object))).toBe(true);
      const after = errors(
        validatePlan({ ...document, objects: [...document.objects, candidate.object] }),
      );
      expect(after).toEqual(before);
    }
  });

  test('кандидат не ломает план: правило организаторов проверяется до показа', () => {
    // Терминал очереди не дальше 3 м от входа — правило из перечня оборудования.
    const rule: Rule = {
      id: 'rule_terminal_entrance',
      source: 'organizer-material',
      rationale: 'Перечень оборудования ОПС: терминал у входа, не далее 3 м.',
      kind: 'distance-to-entrance',
      objectTypeId: 'ot_queue_terminal',
      maxDistance_m: 3,
      entranceId: null,
    };
    const document = plan({
      walls: [{ id: 'w_north', from: [0, 8], to: [10, 8], thickness_m: 0.2, height_m: 3 }],
      openings: [
        { id: 'op_entrance', wallId: 'w_north', offset_m: 4, width_m: 1.2, kind: 'entrance', sill_m: 0, height_m: 2.1 },
      ],
      catalog: catalog([rule]),
    });

    // Якорь в дальнем углу: без проверки правила перебор отдал бы место там.
    const candidates = values(document, 'ot_queue_terminal', null, [0.5, 0.5]);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const entrance: Point = [4.6, 8];
      const away = Math.hypot(
        candidate.object.position[0] - entrance[0],
        candidate.object.position[1] - entrance[1],
      );
      expect(away).toBeLessThanOrEqual(rule.maxDistance_m);
    }
  });

  test('допущение команды не сужает перебор, а только помечает кандидата', () => {
    const assumption: Rule = {
      id: 'rule_terminal_entrance',
      source: 'team-assumption',
      rationale: 'Правило команды: терминал желательно держать у входа.',
      kind: 'distance-to-entrance',
      objectTypeId: 'ot_queue_terminal',
      maxDistance_m: 3,
      entranceId: null,
    };
    const document = plan({
      walls: [{ id: 'w_north', from: [0, 8], to: [10, 8], thickness_m: 0.2, height_m: 3 }],
      openings: [
        { id: 'op_entrance', wallId: 'w_north', offset_m: 4, width_m: 1.2, kind: 'entrance', sill_m: 0, height_m: 2.1 },
      ],
      catalog: catalog([assumption]),
    });

    // Вход в 8 м от якоря: правило-предупреждение не запрещает это место.
    expect(values(document, 'ot_queue_terminal', null, [0.5, 0.5])[0]?.object.position).toEqual([0.5, 0.5]);
  });

  test('квадратный объект не предлагается дважды одним отпечатком', () => {
    const document = plan();

    const candidates = values(document, 'ot_queue_terminal', null, [5, 4]);

    // 0° и 90° для квадрата 0.5×0.5 — одно и то же место, а не два варианта.
    expect(new Set(candidates.map((candidate) => candidate.object.position.join(','))).size).toBe(
      candidates.length,
    );
  });

  test('узкий проход: подходит только поворот на 90°', () => {
    // Свободна полоса x ∈ [4, 4.9]: стол 1.4×0.8 проходит только боком.
    const document = plan({
      objects: [
        object('eq_left', 'ot_block', [2, 4], [4, 8]),
        object('eq_right', 'ot_block', [7.45, 4], [5.1, 8]),
      ],
    });

    const candidates = values(document, 'ot_desk', null);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.object.rotation_deg).toBe(90);
      expect(candidate.object.position[0]).toBeGreaterThanOrEqual(4.4);
      expect(candidate.object.position[0]).toBeLessThanOrEqual(4.5);
    }
  });

  test('в проход уже объекта места нет ни при каком повороте', () => {
    const document = plan({
      objects: [
        object('eq_left', 'ot_block', [2, 4], [4, 8]),
        object('eq_right', 'ot_block', [7.3, 4], [5.4, 8]),
      ],
    });

    // Полоса 0.6 м: стол 1.4×0.8 не проходит ни в одной из двух ориентаций.
    expect(values(document, 'ot_desk', null)).toEqual([]);
  });

  test('заполненный зал не даёт кандидатов и не считается ошибкой', () => {
    const document = plan({ objects: [object('eq_all', 'ot_block', [5, 4], [10, 8])] });

    const result = place(document, 'ot_desk', null);

    expect(result).toEqual({ ok: true, value: [] });
  });

  test('оборудование под потолком не мешает мебели на полу', () => {
    const document = plan({
      objects: [
        object('eq_camera', 'ot_camera', [5, 4], [0.15, 0.15], { base_m: 2.6, height_m: 0.15 }),
      ],
    });

    const candidates = values(document, 'ot_desk', null, [5, 4]);

    expect(candidates[0]?.object.position).toEqual([5, 4]);
  });

  test('кандидаты целиком внутри целевой зоны и привязаны к ней', () => {
    // Зона Г-образная, якорь — в вырезе: место рядом с якорем лежит в
    // помещении, но вне зоны, и предлагать его нельзя.
    const polygon: Polygon = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
    const document = plan({ zones: [zone('z_client', 'zt_client', polygon)] });

    const candidates = values(document, 'ot_desk', 'z_client', [4, 4]);

    expect(candidates.length).toBe(PLACEMENT_SEARCH.maxCandidates);
    for (const candidate of candidates) {
      expect(contains(polygon, footprint(candidate.object))).toBe(true);
      expect(candidate.object.zoneId).toBe('z_client');
    }
  });

  test('правило количества из материалов организаторов закрывает зону', () => {
    const limit: Rule = {
      id: 'rule_desk_max',
      source: 'organizer-material',
      rationale: 'Материалы организаторов: в клиентской зоне не более одного стола.',
      kind: 'count',
      zoneTypeId: 'zt_client',
      objectTypeId: 'ot_desk',
      scope: 'inclusive',
      min: null,
      max: 1,
    };
    const zones = [zone('z_client', 'zt_client', [[0, 0], [6, 0], [6, 6], [0, 6]])];
    const occupied = [
      object('eq_desk', 'ot_desk', [1, 1], [1.4, 0.8], {
        height_m: 0.75,
        zoneId: 'z_client',
      }),
    ];

    // Место в зоне геометрически есть, но второй стол нарушит норму.
    expect(values(plan({ zones, objects: occupied, catalog: catalog([limit]) }), 'ot_desk', 'z_client')).toEqual([]);

    // То же правило как допущение команды — предупреждение: место предлагается.
    const assumed = { ...limit, source: 'team-assumption' as const };
    expect(
      values(plan({ zones, objects: occupied, catalog: catalog([assumed]) }), 'ot_desk', 'z_client').length,
    ).toBe(PLACEMENT_SEARCH.maxCandidates);
  });

  test('якорь задаёт, около чего искать; порядок повторяем', () => {
    const document = plan();

    const nearOrigin = values(document, 'ot_desk', null, [1, 1]);
    const nearCorner = values(document, 'ot_desk', null, [9, 7]);

    expect(nearOrigin[0]?.object.position).toEqual([1, 1]);
    expect(nearCorner[0]?.object.position).toEqual([9, 7]);
    expect(values(document, 'ot_desk', null, [1, 1])).toEqual(nearOrigin);
  });

  test('кандидат получает факты «было → стало» из расчёта площадей', () => {
    const document = plan();

    const candidate = values(document, 'ot_desk', null, [5, 4])[0];

    expect(candidate).toBeDefined();
    const facts = Object.fromEntries(
      (candidate?.facts ?? []).map((entry) => [`${entry.metric}.${entry.phase}`, entry.value]),
    );
    expect(facts['area.free.current']).toBe(80);
    // Стол 1.4×0.8 = 1.12 м² занятого пола.
    expect(facts['area.free.after']).toBe(78.88);
    expect(facts['equipment.count.current']).toBe(0);
    expect(facts['equipment.count.after']).toBe(1);
    expect(facts['placement.distance.current']).toBe(0);
  });

  test('идентификатор кандидата не занят планом и не попадает в план', () => {
    const document = plan();

    const candidates = values(document, 'ot_desk', null);

    const ids = new Set(document.objects.map((entry) => entry.id));
    for (const candidate of candidates) {
      expect(ids.has(candidate.object.id)).toBe(false);
      expect(candidate.id).toBe(candidate.object.id);
    }
    expect(new Set(candidates.map((entry) => entry.id)).size).toBe(candidates.length);
    expect(document.objects).toEqual([]);
  });

  test('большой зал отвечает в пределах бюджета перебора', () => {
    const document = plan({
      room: { id: 'room_big', boundary: [[0, 0], [60, 0], [60, 40], [0, 40]], ceilingHeight_m: 3 },
    });

    // Сетка 0.1 м на 60×40 — это 240 000 позиций, вдвое больше бюджета:
    // ответ приходит из окрестности якоря, а не из обхода всего зала.
    expect((60 / PLACEMENT_SEARCH.step_m) * (40 / PLACEMENT_SEARCH.step_m)).toBeGreaterThan(
      PLACEMENT_SEARCH.maxProbes,
    );
    const candidates = values(document, 'ot_desk', null, [55, 35]);

    expect(candidates.length).toBe(PLACEMENT_SEARCH.maxCandidates);
    expect(candidates[0]?.object.position).toEqual([55, 35]);
  });

  test('неизвестный тип и отсутствующая зона — отказ с кодом, а не пустой список', () => {
    const document = plan();

    expect(place(document, 'ot_missing', null)).toMatchObject({
      ok: false,
      issues: [{ code: PLACEMENT_ISSUE_CODES.UNKNOWN_OBJECT_TYPE }],
    });
    expect(place(document, 'ot_desk', 'z_missing')).toMatchObject({
      ok: false,
      issues: [{ code: PLACEMENT_ISSUE_CODES.TARGET_ZONE_MISSING }],
    });
  });

  test('самопересекающийся контур не даёт выдуманных мест', () => {
    const document = plan({
      room: { id: 'room_bowtie', boundary: [[0, 0], [10, 8], [10, 0], [0, 8]], ceilingHeight_m: 3 },
    });

    const result = place(document, 'ot_desk', null);

    expect(result.ok).toBe(false);
  });
});
