/**
 * G02 acceptance: an object belongs to the deepest zone that contains its whole
 * footprint, and anything doubtful stays unassigned with a diagnostic rather
 * than being guessed into the wrong zone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CONTRACT_ISSUE_CODES, type Equipment, type PlanDocument, type Zone } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import {
  RELATION_ISSUE_CODES,
  hasZoneCycle,
  reconcileZones,
  relationIssues,
  resolveZone,
  zoneDepth,
} from './index';

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`Фикстура ${name} не разобралась`);
  return parsed.value;
}

function moved(object: Equipment, position: [number, number]): Equipment {
  return { ...object, position };
}

function objectOf(plan: PlanDocument, id: string): Equipment {
  const found = plan.objects.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Нет объекта ${id}`);
  return found;
}

describe('глубина вложенности', () => {
  const plan = loadPlan('nested.json');

  test('корневая зона имеет глубину 0, вложенная — 1', () => {
    expect(zoneDepth('z_client', plan.zones)).toBe(0);
    expect(zoneDepth('z_waiting', plan.zones)).toBe(1);
    expect(hasZoneCycle(plan.zones)).toBe(false);
  });
});

describe('назначение объекта зоне', () => {
  const plan = loadPlan('nested.json');
  const bench = objectOf(plan, 'eq_bench_1');

  test('объект целиком внутри вложенной зоны получает именно её, а не родителя', () => {
    const resolution = resolveZone(bench, plan.zones);
    expect(resolution.zoneId).toBe('z_waiting');
    expect(resolution.issues).toEqual([]);
  });

  test('объект, пересекающий границу вложенной зоны, поднимается к родителю', () => {
    const resolution = resolveZone(moved(bench, [4.5, 6]), plan.zones);
    expect(resolution.zoneId).toBe('z_client');
  });

  test('объект вне всех зон остаётся без зоны и получает диагностику с геометрией', () => {
    const resolution = resolveZone(moved(bench, [9.5, 7.9]), plan.zones);
    expect(resolution.zoneId).toBeNull();
    expect(resolution.issues.map((entry) => entry.code)).toContain(
      RELATION_ISSUE_CODES.ZONE_UNASSIGNED,
    );
    expect(resolution.issues[0]?.polygon).toHaveLength(4);
    expect(resolution.issues[0]?.refs[0]?.id).toBe('eq_bench_1');
  });
});

describe('неоднозначность и цикл', () => {
  test('две соседние зоны одной глубины оставляют объект без зоны', () => {
    const plan = loadPlan('minimal.json');
    const sibling: Zone = {
      ...plan.zones[0]!,
      id: 'z_client_b',
      name: 'Вторая клиентская зона',
    };
    const resolution = resolveZone(objectOf(plan, 'eq_work_1'), [...plan.zones, sibling]);
    expect(resolution.zoneId).toBeNull();
    expect(resolution.issues.map((entry) => entry.code)).toEqual([
      CONTRACT_ISSUE_CODES.ZONE_AMBIGUOUS,
    ]);
    expect(resolution.issues[0]?.message).toContain('z_client_b');
  });

  test('цикл parentId обнаруживается и останавливает пересчёт', () => {
    const plan = loadPlan('nested.json');
    const looped: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone) => {
        if (zone.id === 'z_waiting') return { ...zone, parentId: 'z_service' };
        if (zone.id === 'z_service') return { ...zone, parentId: 'z_waiting' };
        return zone;
      }),
    };
    expect(hasZoneCycle(looped.zones)).toBe(true);
    expect(zoneDepth('z_waiting', looped.zones)).toBeNull();

    const result = reconcileZones(looped);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Пересчёт не должен был пройти');
    expect(result.issues[0]?.code).toBe(CONTRACT_ISSUE_CODES.ZONE_CYCLE);
  });
});

describe('пересчёт связей', () => {
  const plan = loadPlan('nested.json');

  test('перемещение объекта меняет его зону', () => {
    const before = reconcileZones(plan);
    if (!before.ok) throw new Error('Исходный план должен пересчитываться');
    expect(objectOf(before.value, 'eq_bench_1').zoneId).toBe('z_waiting');

    const relocated: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object) =>
        object.id === 'eq_bench_1' ? moved(object, [8.5, 4]) : object,
      ),
    };
    const after = reconcileZones(relocated);
    if (!after.ok) throw new Error('Пересчёт после перемещения должен пройти');
    expect(objectOf(after.value, 'eq_bench_1').zoneId).toBe('z_service');
  });

  test('объект без зоны не срывает пересчёт, но попадает в диагностику', () => {
    const relocated: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object) =>
        object.id === 'eq_bench_1' ? moved(object, [9.5, 7.9]) : object,
      ),
    };
    const result = reconcileZones(relocated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(objectOf(result.value, 'eq_bench_1').zoneId).toBeNull();
    expect(relationIssues(relocated).map((entry) => entry.code)).toContain(
      RELATION_ISSUE_CODES.ZONE_UNASSIGNED,
    );
  });

  test('невычислимая геометрия помещения обнуляет связи и сообщает об этом', () => {
    const broken: PlanDocument = {
      ...plan,
      room: { ...plan.room, boundary: [[0, 0], [10, 8], [10, 0], [0, 8]] },
    };
    const result = reconcileZones(broken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.objects.every((object) => object.zoneId === null)).toBe(true);
    expect(relationIssues(broken).map((entry) => entry.code)).toEqual([
      CONTRACT_ISSUE_CODES.RELATIONS_STALE,
    ]);
  });
  test('невычислимая геометрия зоны тоже обнуляет связи: угадывать зону нельзя', () => {
    const broken: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone, index) =>
        index === 0
          ? {
              ...zone,
              polygon: [
                [0, 0],
                [7, 8],
                [7, 0],
                [0, 8],
              ] as PlanDocument['room']['boundary'],
            }
          : zone,
      ),
    };

    const result = reconcileZones(broken);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.objects.every((object) => object.zoneId === null)).toBe(true);
    expect(relationIssues(broken).map((entry) => entry.code)).toContain(
      CONTRACT_ISSUE_CODES.RELATIONS_STALE,
    );
  });
});
