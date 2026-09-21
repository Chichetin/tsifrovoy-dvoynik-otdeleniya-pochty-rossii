/**
 * V01 unit checks: the cases the organizers' example does not contain.
 *
 * The example is exercised end to end in `tests/example-plan-checks.test.ts`;
 * here are the rest — a polygon that cannot be used at all, a zone that leaves
 * its parent, an upper bound on a stocking rule, and the rule that must not
 * fire: a camera on the wall above a desk is not a collision.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Equipment, Issue, PlanDocument, Point } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { VALIDATION_ISSUE_CODES, validatePlan } from './index';

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.issues.map((i) => i.code).join(', ')}`);
  return parsed.value;
}

function codesOf(issues: Issue[]): string[] {
  return issues.map((entry) => entry.code);
}

function firstObject(plan: PlanDocument): Equipment {
  const object = plan.objects[0];
  if (object === undefined) throw new Error('в фикстуре нет объектов');
  return object;
}

describe('чистый план молчит', () => {
  test('minimal.json не даёт ни одной находки', () => {
    expect(validatePlan(loadPlan('minimal.json'))).toEqual([]);
  });
});

describe('невычислимая геометрия сообщается первой и одна', () => {
  test('самопересекающийся контур зоны заслоняет остальные проверки', () => {
    const plan = loadPlan('nested.json');
    const bowtie: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone, index) =>
        index === 0
          ? { ...zone, polygon: [[0, 0], [4, 4], [4, 0], [0, 4]] as Point[] }
          : zone,
      ),
    };

    const issues = validatePlan(bowtie);
    expect(codesOf(issues)).toEqual([VALIDATION_ISSUE_CODES.POLYGON_UNUSABLE]);
    expect(issues[0]?.polygon).toEqual([[0, 0], [4, 4], [4, 0], [0, 4]]);
  });
});

describe('границы', () => {
  test('зона за пределами помещения', () => {
    const plan = loadPlan('minimal.json');
    const outside: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone) => ({
        ...zone,
        polygon: [[20, 20], [24, 20], [24, 24], [20, 24]] as Point[],
      })),
    };

    expect(codesOf(validatePlan(outside))).toContain(VALIDATION_ISSUE_CODES.ZONE_OUTSIDE_ROOM);
  });

  test('вложенная зона вне родителя', () => {
    const plan = loadPlan('nested.json');
    const escaped: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone) =>
        zone.id === 'z_waiting'
          ? { ...zone, polygon: [[6, 1], [9, 1], [9, 3], [6, 3]] as Point[] }
          : zone,
      ),
    };

    const issues = validatePlan(escaped).filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.ZONE_OUTSIDE_PARENT,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.refs.map((ref) => ref.id)).toEqual(['z_waiting', 'z_client']);
  });

  test('объект за пределами помещения', () => {
    const plan = loadPlan('minimal.json');
    const outside: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object) => ({ ...object, position: [30, 30] as Point })),
    };

    expect(codesOf(validatePlan(outside))).toContain(VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM);
  });
});

describe('зоны, налезающие друг на друга (D-223)', () => {
  const zoneAt = (plan: PlanDocument, id: string, polygon: Point[]) => ({
    ...plan.zones[0]!,
    id,
    name: id,
    parentId: null,
    polygon,
  });

  test('зона, наполовину вышедшая из соседней, объясняется одной находкой', () => {
    const plan = loadPlan('minimal.json');
    // z_client — 0..7 по X; новая зона выходит за неё до 9.
    const overlapping: PlanDocument = {
      ...plan,
      zones: [...plan.zones, zoneAt(plan, 'z_half', [[6, 1], [9, 1], [9, 3], [6, 3]])],
    };

    const issues = validatePlan(overlapping).filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.refs.map((ref) => ref.id)).toEqual(['z_client', 'z_half']);
    expect(issues[0]?.severity).toBe('warning');
    // Подсвечивается меньшая из двух: обычно это та, которую только что обвели.
    expect(issues[0]?.polygon).toEqual([[6, 1], [9, 1], [9, 3], [6, 3]]);
  });

  test('зона, совпавшая с соседней по границе, тоже находка', () => {
    const plan = loadPlan('minimal.json');
    const doubled: PlanDocument = {
      ...plan,
      zones: [...plan.zones, zoneAt(plan, 'z_same', [...plan.zones[0]!.polygon])],
    };

    expect(
      validatePlan(doubled).filter(
        (entry) => entry.code === VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE,
      ),
    ).toHaveLength(1);
  });

  test('вложенная зона и зоны встык находкой не считаются', () => {
    const nested = loadPlan('nested.json');
    expect(codesOf(validatePlan(nested))).not.toContain(
      VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE,
    );

    const plan = loadPlan('minimal.json');
    // Встык к z_client по грани x = 7: общей площади нет.
    const side: PlanDocument = {
      ...plan,
      zones: [...plan.zones, zoneAt(plan, 'z_side', [[7, 0], [10, 0], [10, 8], [7, 8]])],
    };
    expect(codesOf(validatePlan(side))).not.toContain(
      VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE,
    );

    // Два треугольника по разные стороны диагонали: охваты налезают, общей
    // площади нет. Дешёвая проверка охватов одна такую пару не отсеет.
    const diagonal: PlanDocument = {
      ...plan,
      zones: [
        zoneAt(plan, 'z_lower', [[0, 0], [3, 0], [0, 3]]),
        zoneAt(plan, 'z_upper', [[4, 1], [4, 4], [1, 4]]),
      ],
    };
    expect(codesOf(validatePlan(diagonal))).not.toContain(
      VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE,
    );
  });
});

describe('коллизии считают только физические объекты', () => {
  test('два стола на одном месте — коллизия', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const doubled: PlanDocument = {
      ...plan,
      objects: [...plan.objects, { ...object, id: `${object.id}_copy` }],
    };

    const issues = validatePlan(doubled).filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.refs.map((ref) => ref.id)).toEqual([object.id, `${object.id}_copy`]);
  });

  test('повёрнутые объекты с общим охватом, но без общего пола — не коллизия; порядок пар прежний (D-205)', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    // Две параллельные диагональные «доски» 2×0,2 со сдвигом:
    // охваты пересекаются, отпечатки — нет. Третья лежит на первой.
    const a = { ...object, id: 'diag_a', position: [2, 2] as [number, number], size_m: [2, 0.2] as [number, number], rotation_deg: 45 };
    const b = { ...object, id: 'diag_b', position: [3.2, 1.6] as [number, number], size_m: [2, 0.2] as [number, number], rotation_deg: 45 };
    const c = { ...a, id: 'diag_c' };
    const issues = validatePlan({ ...plan, objects: [a, b, c] }).filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
    );
    expect(issues.map((entry) => entry.refs.map((ref) => ref.id))).toEqual([['diag_a', 'diag_c']]);
  });

  test('нефизический тип в том же месте коллизией не считается', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const marker = { ...object, id: 'ot_marker_instance', typeId: 'ot_marker' };
    const withMarker: PlanDocument = {
      ...plan,
      catalog: {
        ...plan.catalog,
        objectTypes: [
          ...plan.catalog.objectTypes,
          {
            id: 'ot_marker',
            label: 'Разметка пола',
            category: 'Вспомогательные элементы',
            defaultSize_m: object.size_m,
            defaultHeight_m: 0.01,
            defaultBase_m: 0,
            physical: false,
            occupiesFloor: false,
            symbol: 'rect' as const,
            color: '#868E96',
            attributes: [],
            provenance: 'Допущение команды: условная разметка для теста проверок.',
          },
        ],
      },
      objects: [...plan.objects, marker],
    };

    expect(codesOf(validatePlan(withMarker))).not.toContain(
      VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
    );
  });
});

describe('правила комплектования', () => {
  test('сообщения называют типы и вход по-человечески, а не внутренними id', () => {
    const parsed = parsePlanDocument(
      JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as unknown,
    );
    if (!parsed.ok) throw new Error('demo/before.json не разобрался');

    const findings = validatePlan(parsed.value);
    const messages = findings.map((entry) => entry.message).join('\n');
    expect(messages).toContain('Скамья / кресла для ожидания');
    expect(messages).toContain('Центральное информационное табло');
    expect(messages).toContain('от главного входа');
    expect(messages).not.toMatch(/«(?:ot_|op_)/);

    const rules = findings.filter((entry) => entry.code.startsWith('RULE_'));
    expect(rules.length).toBeGreaterThan(0);
    for (const entry of rules) {
      expect(entry.ruleIds).toHaveLength(1);
      expect(entry.message).not.toContain(entry.ruleIds?.[0]);
    }
  });

  test('верхняя граница правила срабатывает и остаётся предупреждением команды', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const overstocked: PlanDocument = {
      ...plan,
      catalog: {
        ...plan.catalog,
        rules: [
          {
            id: 'rule_test_max',
            kind: 'count',
            source: 'team-assumption',
            rationale: 'Проверка верхней границы.',
            zoneTypeId: 'zt_client',
            objectTypeId: object.typeId,
            scope: 'inclusive',
            min: null,
            max: 0,
          },
        ],
      },
    };

    const issues = validatePlan(overstocked).filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.message).toContain('допущение команды, не норматив Почты');
    expect(issues[0]?.message).not.toContain('rule_test_max');
    expect(issues[0]?.ruleIds).toEqual(['rule_test_max']);
    // Тип назван как в библиотеке, а не внутренним кодом (operator №8).
    const label = plan.catalog.objectTypes.find((type) => type.id === object.typeId)?.label;
    expect(issues[0]?.message).toContain(`«${label}»`);
    expect(issues[0]?.message).not.toContain(object.typeId);
  });

  test('правило расстояния без входа в плане говорит об этом, а не молчит', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const noEntrance: PlanDocument = {
      ...plan,
      openings: [],
      catalog: {
        ...plan.catalog,
        rules: [
          {
            id: 'rule_test_distance',
            kind: 'distance-to-entrance',
            source: 'organizer-material',
            rationale: 'Проверка отсутствия входа.',
            objectTypeId: object.typeId,
            maxDistance_m: 3,
            entranceId: null,
          },
        ],
      },
    };

    const issues = validatePlan(noEntrance).filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_ENTRANCE_MISSING,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toContain('материалы организаторов');
    expect(issues[0]?.message).not.toContain('rule_test_distance');
    expect(issues[0]?.ruleIds).toEqual(['rule_test_distance']);
  });
});

describe('стены в сообщениях', () => {
  test('наружная стена названа по назначению, её id остаётся только в refs', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const againstWall: PlanDocument = {
      ...plan,
      objects: [{ ...object, position: [2, 7.9] }],
    };
    const found = validatePlan(againstWall).find(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
    );

    expect(found?.message).toContain('пересекает наружную стену');
    expect(found?.message).not.toContain('w_');
    expect(found?.refs.some((ref) => ref.kind === 'wall')).toBe(true);
  });

  test('внутренняя стена названа перегородкой', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const withPartition: PlanDocument = {
      ...plan,
      walls: [
        ...plan.walls,
        { id: 'w_partition', from: [5, 0], to: [5, 8], thickness_m: 0.1, height_m: 3 },
      ],
      objects: [{ ...object, position: [5, 2] }],
    };
    const found = validatePlan(withPartition).find(
      (entry) =>
        entry.code === VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL &&
        entry.refs.some((ref) => ref.id === 'w_partition'),
    );

    expect(found?.message).toContain('пересекает перегородку');
    expect(found?.message).not.toContain('w_partition');
  });
});

describe('одна проблема — одна находка (operator №19, D-157)', () => {
  const placementCodes = new Set<string>([
    VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE,
    'ZONE_UNASSIGNED',
  ]);

  function placementIssuesOf(plan: PlanDocument, id: string): Issue[] {
    return validatePlan(plan).filter(
      (entry) => placementCodes.has(entry.code) && entry.refs.some((ref) => ref.id === id),
    );
  }

  test('объект со своей зоной вне всех зон — только «не лежит в своей зоне»', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    // Центр на x = 7 кладёт стол поперёк границы зоны 0..7, но внутри помещения 0..10.
    const straddling: PlanDocument = {
      ...plan,
      objects: [{ ...object, position: [7, 2] as Point }],
    };

    const found = placementIssuesOf(straddling, object.id);
    expect(codesOf(found)).toEqual([VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE]);
    expect(found[0]?.refs.map((ref) => ref.id)).toEqual([object.id, 'z_client']);
  });

  test('объект без зоны вне всех зон по-прежнему сообщается', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const loose: PlanDocument = {
      ...plan,
      objects: [{ ...object, position: [7, 2] as Point, zoneId: null }],
    };

    expect(codesOf(placementIssuesOf(loose, object.id))).toEqual(['ZONE_UNASSIGNED']);
  });

  test('другая проблема о том же объекте не снимается: неоднозначная зона остаётся', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const base = plan.zones[0];
    if (base === undefined) throw new Error('в фикстуре нет зон');
    // Две корневые зоны одинаковой глубины накрывают стол, своя z_client — нет.
    const ambiguous: PlanDocument = {
      ...plan,
      zones: [
        ...plan.zones,
        { ...base, id: 'z_right', polygon: [[7, 0], [10, 0], [10, 8], [7, 8]] as Point[] },
        { ...base, id: 'z_right_low', polygon: [[7, 0], [10, 0], [10, 4], [7, 4]] as Point[] },
      ],
      objects: [{ ...object, position: [8.5, 2] as Point }],
    };

    const about = validatePlan(ambiguous).filter((entry) =>
      entry.refs.some((ref) => ref.id === object.id),
    );
    expect(codesOf(about)).toEqual(
      expect.arrayContaining([VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE, 'ZONE_AMBIGUOUS']),
    );
    expect(codesOf(about)).not.toContain('ZONE_UNASSIGNED');
  });

  test('чужой объект вне зон не теряет свою находку из-за соседа', () => {
    const plan = loadPlan('minimal.json');
    const object = firstObject(plan);
    const two: PlanDocument = {
      ...plan,
      objects: [
        { ...object, position: [7, 2] as Point },
        { ...object, id: 'eq_loose', position: [7, 6] as Point, zoneId: null },
      ],
    };

    expect(codesOf(placementIssuesOf(two, object.id))).toEqual([
      VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE,
    ]);
    expect(codesOf(placementIssuesOf(two, 'eq_loose'))).toEqual(['ZONE_UNASSIGNED']);
  });
});
