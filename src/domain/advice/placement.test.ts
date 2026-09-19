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
import { spawnSync } from 'node:child_process';
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
import { SCHEMA_VERSION, TOLERANCE } from '../../contracts/model';
import { contains, footprint, polygonSegmentDistance } from '../geometry';
import { validatePlan } from '../validation';
import {
  PLACEMENT_ISSUE_CODES,
  PLACEMENT_SEARCH,
  findPlacements,
  separationFor,
  spreadApart,
} from './placement';

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

/** Тип из справочника документа: разнос вариантов считается по нему. */
function typeOf(document: PlanDocument, typeId: string): ObjectType {
  const type = document.catalog.objectTypes.find((entry) => entry.id === typeId);
  if (type === undefined) throw new Error(`в справочнике теста нет типа ${typeId}`);
  return type;
}

function values(document: PlanDocument, typeId: string, zoneId: string | null, anchor?: Point) {
  const result = place(document, typeId, zoneId, anchor);
  if (!result.ok) throw new Error(`ожидался результат, получены проблемы: ${JSON.stringify(result.issues)}`);
  return result.value;
}

describe('A01: поиск места', () => {
  test('бюджет поиска ограничивает, а места остаются в досягаемости входа', () => {
    const document = plan({
      room: { id: 'room_main', boundary: [[0, 0], [1e6, 0], [1e6, 1e6], [0, 1e6]], ceilingHeight_m: 3 },
      walls: [{ id: 'wall', from: [0, 0], to: [10, 0], thickness_m: 0.2, height_m: 3 }],
      openings: [{ id: 'entrance', wallId: 'wall', offset_m: 0, width_m: 1, kind: 'entrance', sill_m: 0, height_m: 2 }],
      catalog: catalog([{
        id: 'reach', kind: 'distance-to-entrance', objectTypeId: 'ot_queue_terminal',
        source: 'organizer-material', rationale: 'Тест ограничения расстояния',
        entranceId: null, maxDistance_m: 3,
      }]),
    });
    // A subprocess can be stopped even if a synchronous grid sweep never yields.
    const script = `
      import { findPlacements } from './src/domain/advice/placement.ts';
      const document = ${JSON.stringify(document)};
      const ask = (openings) => findPlacements({ ...document, openings }, {
        scenario: 'place', typeId: 'ot_queue_terminal', zoneId: null,
      });

      // Вход — проём шириной 1 м от начала стены (0,0)–(10,0), центр (0,5; 0).
      const reachable = ask(document.openings);
      if (!reachable.ok || reachable.value.length === 0) process.exit(1);
      for (const candidate of reachable.value) {
        const [x, y] = candidate.object.position;
        if (Math.hypot(x - 0.5, y) > 3 + 1e-6) process.exit(2);
      }

      // Без входа правило «не далее 3 м от входа» неисполнимо: мест нет.
      const unreachable = ask([]);
      if (!unreachable.ok || unreachable.value.length !== 0) process.exit(3);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      timeout: 4000,
      encoding: 'utf8',
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
  }, 8000);

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

  test('незапертый информационный слой не используется для нового объекта', () => {
    const document = plan({
      layers: [
        { id: 'l_base', name: 'Основной', visible: true, locked: true, order: 0, typeId: null },
        { id: 'l_heat', name: 'Нагрузка', visible: true, locked: false, order: 1, typeId: 'lt_heat' },
      ],
    });

    expect(place(document, 'ot_desk', null)).toMatchObject({
      ok: false,
      issues: [{ code: PLACEMENT_ISSUE_CODES.TARGET_LAYER_MISSING }],
    });
  });

  test('варианты стоят в разных местах, а не в одной точке с разницей в шаг сетки', () => {
    const document = plan({});

    const candidates = values(document, 'ot_desk', null);

    expect(candidates.length).toBe(PLACEMENT_SEARCH.maxCandidates);
    // Сетка поиска — 0,1 м, и раньше три лучших места по рангу были соседними
    // клетками: человек видел «три варианта» в одной точке. Каждая пара
    // вариантов обязана отличаться видимо.
    const separation = separationFor(typeOf(document, 'ot_desk'));
    for (const left of candidates) {
      for (const right of candidates) {
        if (left.id === right.id) continue;
        const gap = Math.hypot(
          left.object.position[0] - right.object.position[0],
          left.object.position[1] - right.object.position[1],
        );
        expect(gap).toBeGreaterThanOrEqual(separation - 1e-6);
      }
    }
  });

  test('разнос считается по самому объекту: длинная сторона, но не меньше предела', () => {
    const document = plan({});
    const desk = typeOf(document, 'ot_desk');

    // Стол 1,4 × 0,8 м: разнос по длинной стороне. Мелочь получает нижний предел.
    expect(separationFor(desk)).toBe(1.4);
    expect(separationFor({ ...desk, defaultSize_m: [0.2, 0.2] })).toBe(
      PLACEMENT_SEARCH.minSeparation_m,
    );
  });

  test('тесная зона честно даёт меньше вариантов, а не почти совпадающие', () => {
    // Полоса 2,2 × 1,2 м: стол 2 × 1 встаёт, но второго такого места нет.
    const document = plan({
      zones: [
        zone('z_strip', 'zt_client', [
          [0, 0],
          [2.2, 0],
          [2.2, 1.2],
          [0, 1.2],
        ]),
      ],
    });

    const candidates = values(document, 'ot_desk', 'z_strip');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThan(PLACEMENT_SEARCH.maxCandidates);
  });

  test('spreadApart берёт лучшее и отбрасывает близкое к уже выбранному', () => {
    const ranked = [
      { position: [0, 0] as Point, tag: 'первый' },
      { position: [0.1, 0] as Point, tag: 'рядом' },
      { position: [3, 0] as Point, tag: 'далеко' },
      { position: [3.05, 0] as Point, tag: 'рядом с далёким' },
      { position: [6, 0] as Point, tag: 'ещё дальше' },
    ];

    expect(spreadApart(ranked, 1, 3).map((entry) => entry.tag)).toEqual([
      'первый',
      'далеко',
      'ещё дальше',
    ]);
    // Предел соблюдается, порядок ранга сохраняется.
    expect(spreadApart(ranked, 1, 2).map((entry) => entry.tag)).toEqual(['первый', 'далеко']);
    // Разнос больше всех расстояний — остаётся один вариант.
    expect(spreadApart(ranked, 100, 3)).toHaveLength(1);
  });

  test('самопересекающийся контур не даёт выдуманных мест', () => {
    const document = plan({
      room: { id: 'room_bowtie', boundary: [[0, 0], [10, 8], [10, 0], [0, 8]], ceilingHeight_m: 3 },
    });

    const result = place(document, 'ot_desk', null);

    expect(result.ok).toBe(false);
  });
});

describe('A01: место у стены', () => {
  /** Помещение 10×8 со стенами по контуру и проёмом-входом в нижней стене. */
  function walled(overrides: Partial<PlanDocument> = {}): PlanDocument {
    return plan({
      walls: [
        { id: 'w_south', from: [0, 0], to: [10, 0], thickness_m: 0.2, height_m: 3 },
        { id: 'w_east', from: [10, 0], to: [10, 8], thickness_m: 0.2, height_m: 3 },
        { id: 'w_north', from: [10, 8], to: [0, 8], thickness_m: 0.2, height_m: 3 },
        { id: 'w_west', from: [0, 8], to: [0, 0], thickness_m: 0.2, height_m: 3 },
      ],
      openings: [
        { id: 'op_entrance', wallId: 'w_south', offset_m: 4.5, width_m: 1, kind: 'entrance', sill_m: 0, height_m: 2 },
      ],
      ...overrides,
    });
  }

  /** Зазор от отпечатка объекта до ближайшего ребра контура помещения. */
  function gapToOutline(document: PlanDocument, object: Equipment): number {
    const outline = document.room.boundary;
    const shape = footprint(object);
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < outline.length; i += 1) {
      const from = outline[i]!;
      const to = outline[(i + 1) % outline.length]!;
      nearest = Math.min(nearest, polygonSegmentDistance(shape, from, to));
    }
    return nearest;
  }

  test('без указанной точки первый вариант стоит у стены, а не в середине зала', () => {
    const document = walled();
    const [best] = values(document, 'ot_desk', null);
    expect(best).toBeDefined();
    // Стена толщиной 0,2 м стоит по контуру, поэтому вплотную к ней — 0,1 м.
    expect(gapToOutline(document, best!.object)).toBeLessThanOrEqual(0.1 + TOLERANCE.coordinate_m);
  });

  test('указанная точка важнее стены: у центра зала вариант встаёт рядом с ней', () => {
    const document = walled();
    const [best] = values(document, 'ot_desk', null, [5, 4]);
    expect(best).toBeDefined();
    expect(Math.hypot(best!.object.position[0] - 5, best!.object.position[1] - 4)).toBeLessThan(1);
  });

  test('в зоне место у стены помещения предпочитается середине зоны', () => {
    const document = walled({
      zones: [zone('z_hall', 'zt_client', [[0.2, 0.2], [6, 0.2], [6, 6], [0.2, 6]])],
    });
    const [best] = values(document, 'ot_desk', 'z_hall');
    expect(best).toBeDefined();
    expect(gapToOutline(document, best!.object)).toBeLessThanOrEqual(0.3 + TOLERANCE.coordinate_m);
  });
});
