/**
 * M01 acceptance: the inventory always describes the plan in front of it.
 *
 * Every edit here goes through `applyCommand`, the same door the editor uses —
 * the point of the package is that a deletion, a type change or a move is
 * reflected without anyone remembering to refresh a second copy of the data.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Command } from '../../contracts/commands';
import type { Equipment, Id, PlanDocument, Zone } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { applyCommand } from '../commands';
import { buildInventory, inventoryObjectLink, inventoryLinkTarget, resolveInventoryLink, markObject, walkActEntries, walkRoute } from './index';

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.issues.map((i) => i.code).join(', ')}`);
  return parsed.value;
}

function apply(plan: PlanDocument, command: Command): PlanDocument {
  const result = applyCommand(plan, command);
  if (!result.ok) throw new Error(`команда отклонена: ${result.issues.map((i) => i.code).join(', ')}`);
  return result.value;
}

function objectById(plan: PlanDocument, id: Id): Equipment {
  const object = plan.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`нет объекта ${id}`);
  return object;
}

function zoneById(plan: PlanDocument, id: Id): Zone {
  const zone = plan.zones.find((entry) => entry.id === id);
  if (zone === undefined) throw new Error(`нет зоны ${id}`);
  return zone;
}

function sum(counts: Record<Id, number>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

describe('форма перечня', () => {
  test('строки идут в порядке документа и не копируют план', () => {
    const plan = loadPlan('nested.json');
    const inventory = buildInventory(plan);

    expect(inventory.rows.map((row) => row.id)).toEqual(plan.objects.map((object) => object.id));
    expect(inventory.rows).not.toBe(plan.objects);
    expect(inventory.rows[0]).toBe(plan.objects[0]);
  });

  test('пустые типы и пустые зоны видны нулями, а не пропусками', () => {
    const plan = loadPlan('nested.json');
    const inventory = buildInventory(plan);

    // z_service в фикстуре есть, но объектов в ней нет.
    expect(inventory.byZoneDirect.z_service).toBe(0);
    expect(inventory.byZoneInclusive.z_service).toBe(0);
    expect(Object.keys(inventory.byType).sort()).toEqual(
      plan.catalog.objectTypes.map((type) => type.id).sort(),
    );
  });

  test('новый тип справочника появляется в перечне с нулём без правки кода', () => {
    const plan = loadPlan('nested.json');
    const workplace = plan.catalog.objectTypes[0];
    if (workplace === undefined) throw new Error('нет типа в справочнике');

    const extended = apply(plan, {
      type: 'catalog.replace',
      catalog: {
        ...plan.catalog,
        objectTypes: [
          ...plan.catalog.objectTypes,
          { ...workplace, id: 'ot_parcel_locker', label: 'Постамат' },
        ],
      },
    });

    expect(buildInventory(extended).byType.ot_parcel_locker).toBe(0);
  });
});

describe('общий итог уникален', () => {
  test('сумма по типам и сумма по зонам с неназначенными дают одно число', () => {
    const plan = loadPlan('nested.json');
    const inventory = buildInventory(plan);

    expect(inventory.rows).toHaveLength(plan.objects.length);
    expect(sum(inventory.byType)).toBe(plan.objects.length);
    expect(sum(inventory.byZoneDirect) + inventory.unassigned).toBe(plan.objects.length);
  });

  test('inclusive суммировать нельзя: вложенный объект посчитан дважды', () => {
    const plan = loadPlan('nested.json');
    const inventory = buildInventory(plan);

    expect(sum(inventory.byZoneInclusive)).toBeGreaterThan(plan.objects.length);
  });

  test('объект без зоны попадает только в неназначенные', () => {
    const plan = loadPlan('nested.json');
    // Зона назначается геометрией, а не полем: скамья ставится на границу
    // z_client и z_service, и целиком не лежит ни в одной из них.
    const detached = apply(plan, {
      type: 'object.put',
      object: { ...objectById(plan, 'eq_bench_1'), position: [7, 6] },
    });
    const inventory = buildInventory(detached);

    expect(objectById(detached, 'eq_bench_1').zoneId).toBeNull();

    expect(inventory.unassigned).toBe(1);
    expect(inventory.byZoneDirect.z_waiting).toBe(0);
    expect(inventory.byZoneInclusive.z_client).toBe(1);
    expect(sum(inventory.byZoneDirect) + inventory.unassigned).toBe(detached.objects.length);
  });

  test('ссылка на исчезнувшую зону не теряет объект из итога', () => {
    const plan = loadPlan('nested.json');
    // Схема такой документ не примет, но он существует между правками: зона
    // удалена, а объект ещё указывает на неё. Потерять его из перечня нельзя.
    const dangling: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object) =>
        object.id === 'eq_bench_1' ? { ...object, zoneId: 'z_deleted' } : object,
      ),
    };

    const inventory = buildInventory(dangling);
    expect(inventory.unassigned).toBe(1);
    expect(inventory.byZoneDirect.z_deleted).toBeUndefined();
    expect(sum(inventory.byZoneDirect) + inventory.unassigned).toBe(dangling.objects.length);
    expect(sum(inventory.byType)).toBe(dangling.objects.length);
  });
});

describe('вложенность', () => {
  test('ребёнок учитывается у родителя только inclusive', () => {
    const inventory = buildInventory(loadPlan('nested.json'));

    // eq_bench_1 лежит в z_waiting, а та вложена в z_client.
    expect(inventory.byZoneDirect.z_waiting).toBe(1);
    expect(inventory.byZoneDirect.z_client).toBe(1);
    expect(inventory.byZoneInclusive.z_waiting).toBe(1);
    expect(inventory.byZoneInclusive.z_client).toBe(2);
  });

  test('переподчинение зоны меняет inclusive у обоих родителей', () => {
    const plan = loadPlan('nested.json');
    const moved = apply(plan, {
      type: 'zone.put',
      zone: { ...zoneById(plan, 'z_waiting'), parentId: 'z_service' },
    });
    const inventory = buildInventory(moved);

    expect(inventory.byZoneInclusive.z_client).toBe(1);
    expect(inventory.byZoneInclusive.z_service).toBe(1);
    expect(inventory.byZoneDirect.z_waiting).toBe(1);
  });

  test('замкнутая вложенность не вешает подсчёт', () => {
    const plan = loadPlan('nested.json');
    // Схема такой документ не примет; перечень считается и на промежуточном
    // состоянии, поэтому цикл должен завершиться, а не зациклить редактор.
    const looped: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone) =>
        zone.id === 'z_client' ? { ...zone, parentId: 'z_waiting' } : zone,
      ),
    };

    const inventory = buildInventory(looped);
    expect(inventory.byZoneInclusive.z_client).toBe(2);
    expect(inventory.byZoneInclusive.z_waiting).toBe(2);
  });
});

describe('правка плана сразу видна в перечне', () => {
  test('удаление уменьшает и общий итог, и группу типа', () => {
    const plan = loadPlan('nested.json');
    const before = buildInventory(plan);
    const after = buildInventory(apply(plan, { type: 'object.delete', id: 'eq_bench_1' }));

    expect(before.byType.ot_bench).toBe(1);
    expect(after.byType.ot_bench).toBe(0);
    expect(after.rows).toHaveLength(before.rows.length - 1);
    expect(after.byZoneDirect.z_waiting).toBe(0);
    expect(after.byZoneInclusive.z_client).toBe(1);
  });

  test('смена типа переносит объект между группами, не меняя итог', () => {
    const plan = loadPlan('nested.json');
    const bench = objectById(plan, 'eq_bench_1');
    const retyped = apply(plan, {
      type: 'object.put',
      object: { ...bench, typeId: 'ot_workplace' },
    });
    const inventory = buildInventory(retyped);

    expect(inventory.byType.ot_bench).toBe(0);
    expect(inventory.byType.ot_workplace).toBe(2);
    expect(inventory.rows).toHaveLength(plan.objects.length);
  });

  test('перенос в другую зону меняет обе группы', () => {
    const plan = loadPlan('nested.json');
    const moved = apply(plan, {
      type: 'object.put',
      object: { ...objectById(plan, 'eq_bench_1'), position: [8.5, 6] },
    });
    const inventory = buildInventory(moved);

    expect(objectById(moved, 'eq_bench_1').zoneId).toBe('z_service');
    expect(inventory.byZoneDirect.z_waiting).toBe(0);
    expect(inventory.byZoneDirect.z_service).toBe(1);
    expect(inventory.byZoneInclusive.z_client).toBe(1);
    expect(inventory.unassigned).toBe(0);
  });

  test('перечень пересчитывается, а не хранится: два вызова на одном плане совпадают', () => {
    const plan = loadPlan('nested.json');
    expect(buildInventory(plan)).toEqual(buildInventory(plan));
  });
});

describe('обход для инвентаризации', () => {
  test('маршрут проходит каждый объект ровно один раз', () => {
    const path = join(process.cwd(), 'demo', 'before.json');
    const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.code).join(', '));
    const plan = parsed.value;
    const route = walkRoute(plan);

    expect(plan.objects.length).toBeGreaterThan(50);
    expect(route).toHaveLength(plan.objects.length);
    expect([...route].sort()).toEqual(plan.objects.map((object) => object.id).sort());
  });

  test('акт: «на месте» не попадает, «не проверен» попадает, номер только у «другой номер»', () => {
    const plan = loadPlan('nested.json');
    const [first, second] = plan.objects;
    if (first === undefined || second === undefined) throw new Error('в фикстуре меньше двух объектов');
    const marked: PlanDocument = {
      ...plan,
      objects: [markObject(first, 'present'), markObject(second, 'broken', 'ИНВ-9'), ...plan.objects.slice(2)],
    };
    const unmarked = plan.objects.slice(2).map((object) => object.id);

    const entries = walkActEntries(marked);

    expect(entries.map((entry) => entry.id)).toEqual([second.id, ...unmarked]);
    expect(entries[0]).toEqual({ id: second.id, mark: 'сломан', foundNumber: null });
    expect(walkActEntries({ ...marked, objects: [markObject(second, 'other-number', 'ИНВ-9')] })).toEqual([
      { id: second.id, mark: 'другой номер', foundNumber: 'ИНВ-9' },
    ]);
    expect(walkActEntries({ ...plan, objects: [first] })).toEqual([
      { id: first.id, mark: 'не проверен', foundNumber: null },
    ]);
  });
});

describe('ссылка на предмет инвентаризации', () => {
  test('сохраняет идентификаторы с пробелами, кириллицей и знаками URL', () => {
    const target = { planId: 'план 1 & 2', objectId: 'объект/#3' };
    const link = inventoryObjectLink('https://example.org/editor/', target);
    expect(link).not.toBeNull();
    expect(inventoryLinkTarget(new URL(link!).search)).toEqual(target);
  });

  test('в наклейку не попадают пароль, старые параметры и фрагмент исходного адреса', () => {
    const link = inventoryObjectLink('https://user:password@example.org/editor/?token=private#draft', {
      planId: 'p1', objectId: 'eq1',
    });
    expect(link).toBe('https://example.org/editor/?plan=p1&object=eq1');
    expect(inventoryObjectLink('javascript:alert(1)', { planId: 'p1', objectId: 'eq1' })).toBeNull();
    expect(inventoryObjectLink('not a URL', { planId: 'p1', objectId: 'eq1' })).toBeNull();
  });

  test('не принимает пустые или неоднозначные идентификаторы', () => {
    for (const search of ['', '?object=eq1', '?plan=p1&object=', '?plan=p1&plan=p2&object=eq1', '?plan=p1&object=eq1&object=eq2']) {
      expect(inventoryLinkTarget(search)).toBeNull();
    }
    expect(inventoryObjectLink('https://example.org/', { planId: '', objectId: 'eq1' })).toBeNull();
  });

  test('одинаковый id предмета в другом плане не выбирается', () => {
    const plan = loadPlan('nested.json');
    const object = plan.objects[0]!;
    const target = { planId: plan.id, objectId: object.id };
    expect(resolveInventoryLink(plan, target)).toEqual({ status: 'found', object });
    expect(resolveInventoryLink({ ...plan, id: 'other-plan' }, target)).toEqual({ status: 'different-plan' });
    expect(resolveInventoryLink({ ...plan, objects: [] }, target)).toEqual({ status: 'missing-object' });
  });
});
