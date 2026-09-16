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
  });
});
