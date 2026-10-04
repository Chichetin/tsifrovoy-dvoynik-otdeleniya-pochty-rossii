/**
 * The organizers' example as our test set for the correctness checks.
 *
 * CLAUDE.md lists exactly what is wrong with `example_plan.json`: three pairs
 * of overlapping objects, two racks that cross the partition and stick out of
 * their zone, and a queue terminal about seven metres from the entrance where
 * the equipment list says three. This test pins every one of them — and pins
 * that fixing one of them removes that code and nothing else.
 *
 * It lives in `tests/` rather than next to the validator because it needs both
 * halves at once: the importer from `src/persistence` and the checks from
 * `src/domain`, which are not allowed to import each other.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Catalog, Issue, PlanDocument, Zone } from '../src/contracts/model';
import { parseCatalog } from '../src/contracts/schema';
import { applyCommand } from '../src/domain/commands';
import { VALIDATION_ISSUE_CODES, validatePlan } from '../src/domain/validation';
import { importOrganizerExample, withTeamCatalog } from '../src/persistence/organizer-import';
import { attributeKeyFromLabel, layersReading } from '../src/features/catalog-editor/catalog-edit';
import { groupIssuesBySubject } from '../src/features/validation/issue-highlight';
import {
  groupAttributeCommand,
  mixedAttributeKeys,
  sharedAttributeDefs,
} from '../src/features/properties/group-attributes';
import { findFix, planFix } from '../src/features/validation/finding-why';
import { decodePlan, encodePlan } from '../src/persistence/codec';
import { createPlanStore } from '../src/state/plan-store';
import { placedObject, placementRefusal } from '../src/features/equipment/placement-ghost';
import { checklistItems } from '../src/features/inventory/rule-checklist';

function readJson(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), ...path), 'utf8')) as unknown;
}

function teamCatalog(): Catalog {
  const parsed = parseCatalog({
    version: '1.0.0',
    objectTypes: readJson('data', 'catalog', 'object-types.json'),
    zoneTypes: readJson('data', 'catalog', 'zone-types.json'),
    layerTypes: readJson('data', 'catalog', 'layer-types.json'),
    rules: readJson('data', 'catalog', 'rules.json'),
  });
  if (!parsed.ok) throw new Error('справочник команды не разобрался');
  return parsed.value;
}

test('catalog attribute removal detects the equipment colour layer dependency', () => {
  const catalog = teamCatalog();
  expect(layersReading(catalog, 'equipmentStatus').map((type) => type.id)).toEqual(['lt_equipment_status']);
  expect(layersReading(catalog, 'unrelated')).toEqual([]);
});

/**
 * The import brings the example's own types but no stocking rules (D-025):
 * the rules come from the team catalog through `withTeamCatalog` — the same
 * path the editor takes when it opens the example.
 */
function examplePlanWithTeamRules(): PlanDocument {
  const importResult = importOrganizerExample(readJson('example_plan.json'));
  if (!importResult.ok) throw new Error('пример не импортировался');
  const merged = withTeamCatalog(importResult.value, teamCatalog());
  if (!merged.ok) {
    throw new Error(`справочники не сомкнулись: ${merged.issues.map((i) => i.code).join(', ')}`);
  }
  return merged.value;
}

function pairsOf(issues: Issue[], code: string): string[][] {
  return issues
    .filter((entry) => entry.code === code)
    .map((entry) => entry.refs.map((ref) => ref.id).sort());
}

function idsOf(issues: Issue[], code: string): string[] {
  return issues
    .filter((entry) => entry.code === code)
    .flatMap((entry) => entry.refs.filter((ref) => ref.kind === 'object').map((ref) => ref.id));
}

const plan = examplePlanWithTeamRules();
const issues = validatePlan(plan);

describe('слияние со справочником команды', () => {
  test('типы примера остаются, наши правила и слои приходят, повторное слияние ничего не дублирует', () => {
    const team = teamCatalog();
    const importResult = importOrganizerExample(readJson('example_plan.json'));
    if (!importResult.ok) throw new Error('пример не импортировался');
    const exampleOnly = importResult.value.catalog.objectTypes
      .map((type) => type.id)
      .filter((id) => !team.objectTypes.some((type) => type.id === id));
    expect(exampleOnly.length).toBeGreaterThan(0);

    const ids = plan.catalog.objectTypes.map((type) => type.id);
    for (const id of exampleOnly) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.catalog.rules.length).toBe(team.rules.length);
    expect(plan.layers.filter((layer) => layer.typeId !== null).map((layer) => layer.typeId)).toEqual(
      team.layerTypes.map((type) => type.id),
    );
    // Every object still resolves to a type after the merge.
    for (const object of plan.objects) expect(ids).toContain(object.typeId);

    const again = withTeamCatalog(plan, team);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.layers.length).toBe(plan.layers.length);
  });
});

describe('известные ошибки примера находятся', () => {
  test('три пары пересекающихся объектов', () => {
    expect(pairsOf(issues, VALIDATION_ISSUE_CODES.OBJECT_COLLISION)).toEqual(
      expect.arrayContaining([
        ['eq_cashier_1', 'eq_rack_1'],
        ['eq_cashier_2', 'eq_rack_2'],
        ['eq_atm', 'eq_bench_1'],
      ]),
    );
  });

  test('стеллажи пересекают перегородку x = 7.5', () => {
    const hits = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
    );
    const racks = hits.filter((entry) =>
      entry.refs.some((ref) => ref.id === 'eq_rack_1' || ref.id === 'eq_rack_2'),
    );

    expect(racks).toHaveLength(2);
    for (const entry of racks) {
      expect(entry.refs.map((ref) => ref.id)).toContain('w_inner_1');
    }
  });

  test('стеллажи не лежат целиком в своей зоне', () => {
    expect(idsOf(issues, VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE)).toEqual(
      expect.arrayContaining(['eq_rack_1', 'eq_rack_2']),
    );
  });

  test('терминал очереди дальше 3 м от входа', () => {
    const far = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE,
    );

    expect(idsOf(far, VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE)).toEqual(['eq_kiosk']);
    // Вход d_main занимает 1.5 м стены; расстояние меряется до его середины
    // (0.75, 7.5), а не до края — от терминала в (0.6, 0.6) это 6.90 м.
    const message = far[0]?.message ?? '';
    // Запятая и неразрывный пробел — как в остальном интерфейсе (formatLength).
    expect(message).toContain('6,90\u00A0м от главного входа');
    expect(message).toContain('не более 3\u00A0м');
    expect(message).not.toContain('d_main');
    expect(far[0]?.refs.map((ref) => ref.id)).toContain('d_main');
    expect(message).toContain('материалы организаторов');
    // #14: план рисует тот же отрезок, что измерило правило.
    expect(far[0]?.measure).toEqual({ from: [0.6, 0.6], to: [0.75, 7.5], distance_m: expect.closeTo(6.9, 2) });
  });

  test('правило организаторов — ошибка, правило команды — предупреждение', () => {
    const organizer = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE,
    );
    const team = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN,
    );

    for (const entry of organizer) expect(entry.severity).toBe('error');
    for (const entry of team) {
      expect(entry.severity).toBe('warning');
      expect(entry.message).toContain('допущение команды, не норматив Почты');
      // Тип назван подписью из справочника, а не кодом (operator 20.09 №8).
      expect(entry.message).not.toMatch(/«ot_[a-z_]+»/);
    }
    // …и именно подписью из справочника этого плана.
    const labels = plan.catalog.objectTypes.map((type) => `«${type.label}»`);
    expect(team.length).toBeGreaterThan(0);
    for (const entry of team) expect(labels.some((label) => entry.message.includes(label))).toBe(true);
  });

  test('каждая находка показывается на плане и называет свои id', () => {
    for (const entry of issues) {
      expect(entry.refs.length).toBeGreaterThan(0);
      if (entry.code === VALIDATION_ISSUE_CODES.RULE_ENTRANCE_MISSING) continue;
      expect(entry.polygon?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('одна проблема — одна находка (operator №19, D-157)', () => {
  test('стеллаж вне своей зоны не повторяется находкой «ни в одной зоне»', () => {
    for (const id of ['eq_rack_1', 'eq_rack_2']) {
      const about = issues.filter((entry) => entry.refs.some((ref) => ref.id === id));
      expect(about.map((entry) => entry.code)).toContain(VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE);
      expect(about.map((entry) => entry.code)).not.toContain('ZONE_UNASSIGNED');
    }
  });

  test('находки одного объекта — одна группа в списке, как один маркер на плане (#14)', () => {
    const groups = groupIssuesBySubject(issues);
    const rack = groups.find((group) => group.ref?.id === 'eq_rack_2');
    expect(rack?.issues.map((entry) => entry.code).sort()).toEqual(
      issues.filter((entry) => entry.refs[0]?.id === 'eq_rack_2').map((entry) => entry.code).sort(),
    );
    expect(rack?.issues.length ?? 0).toBeGreaterThan(1);
    expect(rack?.severity).toBe('error');
    expect(groups.flatMap((group) => group.issues)).toHaveLength(issues.length);
  });

  test('пример как есть, без правил команды, — ровно 8 находок', () => {
    // Три коллизии, три стены (два стеллажа и ПВЗ через наружную стену),
    // два стеллажа вне своей зоны. До D-157 к ним добавлялись два повтора
    // ZONE_UNASSIGNED о тех же стеллажах — 10 строк о 8 проблемах.
    const imported = importOrganizerExample(readJson('example_plan.json'));
    if (!imported.ok) throw new Error('пример не импортировался');
    const codes = validatePlan(imported.value).map((entry) => entry.code).sort();
    expect(codes).toEqual(
      [
        ...Array<string>(3).fill(VALIDATION_ISSUE_CODES.OBJECT_COLLISION),
        ...Array<string>(3).fill(VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL),
        ...Array<string>(2).fill(VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE),
      ].sort(),
    );
  });
});

describe('исправление снимает ровно свой код', () => {
  test('отодвинутый стеллаж перестаёт пересекать и стену, и кассу', () => {
    const rack = plan.objects.find((object) => object.id === 'eq_rack_1');
    if (rack === undefined) throw new Error('нет eq_rack_1');

    const fixed = applyCommand(plan, {
      type: 'object.put',
      // Ширина 2 м: центр на 8.6 уводит левый край на 7.6 — за перегородку,
      // а подъём по Y выводит стеллаж из-под сейфа в углу.
      object: { ...rack, position: [8.6, 1.6] },
    });
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;

    const after = validatePlan(fixed.value);
    const mentionsRack = (entry: Issue): boolean =>
      entry.refs.some((ref) => ref.id === 'eq_rack_1');

    expect(after.filter(mentionsRack).map((entry) => entry.code)).toEqual([]);
    // Вторая пара и терминал никуда не делись.
    expect(pairsOf(after, VALIDATION_ISSUE_CODES.OBJECT_COLLISION)).toEqual(
      expect.arrayContaining([['eq_cashier_2', 'eq_rack_2']]),
    );
    expect(idsOf(after, VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE)).toEqual(['eq_kiosk']);
  });

  test('терминал у входа снимает нарушение расстояния', () => {
    const kiosk = plan.objects.find((object) => object.id === 'eq_kiosk');
    if (kiosk === undefined) throw new Error('нет eq_kiosk');

    const fixed = applyCommand(plan, {
      type: 'object.put',
      // Вход d_main — в точке (0.75, 7.5) на северной стене.
      object: { ...kiosk, position: [1.5, 6.8] },
    });
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;

    expect(idsOf(validatePlan(fixed.value), VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE))
      .toEqual([]);
  });
});

describe('срок ТО (#29)', () => {
  const kiosk = plan.objects.find((object) => object.id === 'eq_kiosk');
  if (kiosk === undefined) throw new Error('нет eq_kiosk');
  const codesFor = (date: string, today = '2026-10-04'): string[] => {
    const next = applyCommand(plan, {
      type: 'object.put',
      object: { ...kiosk, attributes: { ...kiosk.attributes, nextMaintenanceDate: date } },
    });
    if (!next.ok) throw new Error('правка не применилась');
    return validatePlan(next.value, today)
      .filter((entry) => entry.code.startsWith('MAINTENANCE_'))
      .map((entry) => entry.code);
  };

  test('тип терминала очереди несёт атрибут из справочника, пример без дат молчит', () => {
    const type = plan.catalog.objectTypes.find((entry) => entry.id === kiosk.typeId);
    expect(type?.attributes.some((attribute) => attribute.key === 'nextMaintenanceDate')).toBe(true);
    expect(type?.provenance).toContain('синтетическая');
    expect(issues.filter((entry) => entry.code.startsWith('MAINTENANCE_'))).toEqual([]);
  });

  test('границы: 15 дн. — тихо, 14 и 0 дн. — скоро, вчера — просрочено', () => {
    expect(codesFor('2026-10-19')).toEqual([]);
    expect(codesFor('2026-10-18')).toEqual([VALIDATION_ISSUE_CODES.MAINTENANCE_DUE_SOON]);
    expect(codesFor('04.10.2026')).toEqual([VALIDATION_ISSUE_CODES.MAINTENANCE_DUE_SOON]);
    expect(codesFor('2026-10-03')).toEqual([VALIDATION_ISSUE_CODES.MAINTENANCE_OVERDUE]);
    expect(codesFor('31.02.2026')).toEqual([VALIDATION_ISSUE_CODES.MAINTENANCE_DATE_INVALID]);
    // Тот же срок через год после «сегодня» — снова просрочен: день — параметр, не часы.
    expect(codesFor('2026-10-19', '2027-10-04')).toEqual([VALIDATION_ISSUE_CODES.MAINTENANCE_OVERDUE]);
  });
});

describe('ключ атрибута из подписи (#13)', () => {
  test('транслитерация: «Дата поверки» → data_poverki', () => {
    expect(attributeKeyFromLabel('Дата поверки', [])).toBe('data_poverki');
    expect(attributeKeyFromLabel('3D-модель', [])).toBe('attr_3d_model');
    expect(attributeKeyFromLabel('  ', [])).toBe('attr');
  });

  test('ключ уникален в типе: занятый получает _2, _3', () => {
    expect(attributeKeyFromLabel('Дата поверки', ['data_poverki'])).toBe('data_poverki_2');
    expect(attributeKeyFromLabel('Дата поверки', ['data_poverki', 'data_poverki_2'])).toBe('data_poverki_3');
  });
});

describe('правка атрибута у группы (#30)', () => {
  test('статус двух касс: одна команда, одно undo, переживает сохранение и открытие', () => {
    const store = createPlanStore(plan);
    const ids = ['eq_cashier_1', 'eq_cashier_2'];
    const members = () => store.getState().document.objects.filter((object) => ids.includes(object.id));
    const status = (attributes: Record<string, unknown>) => String(attributes.equipmentStatus ?? '');
    const defs = sharedAttributeDefs(plan.catalog, members());
    expect(defs.map((def) => def.key)).toContain('equipmentStatus');

    const [first] = members();
    if (first === undefined) throw new Error('кассы нет в примере');
    store.getState().dispatch({
      type: 'object.put',
      object: { ...first, attributes: { ...first.attributes, equipmentStatus: 'working' } },
    });
    store.getState().selectMany(ids);
    expect(mixedAttributeKeys(members(), defs, (attributes) => status(attributes)).has('equipmentStatus')).toBe(true);

    const before = store.getState().document;
    expect(store.getState().dispatch(groupAttributeCommand(members(), 'equipmentStatus', 'repair')).ok).toBe(true);
    expect(members().map((object) => object.attributes.equipmentStatus)).toEqual(['repair', 'repair']);
    expect(store.getState().selected.size).toBe(2);

    store.getState().undo();
    expect(store.getState().document).toBe(before);
    store.getState().redo();

    const saved = encodePlan(store.getState().document);
    if (!saved.ok) throw new Error('план не сохранился');
    const reopened = decodePlan(saved.value);
    if (!reopened.ok) throw new Error('план не открылся');
    expect(
      reopened.value.objects.filter((object) => ids.includes(object.id)).map((object) => object.attributes.equipmentStatus),
    ).toEqual(['repair', 'repair']);
  });
});

describe('вариант исправления находки (#33)', () => {
  test('коллизия окна со стеллажом: переставляется стеллаж, место находится', () => {
    const issues = validatePlan(plan);
    const collision = issues.find(
      (entry) =>
        entry.code === VALIDATION_ISSUE_CODES.OBJECT_COLLISION &&
        entry.refs.some((ref) => ref.id === 'eq_rack_1') &&
        entry.refs.some((ref) => ref.id === 'eq_cashier_1'),
    );
    if (collision === undefined) throw new Error('коллизии окна со стеллажом нет');
    const fix = planFix(plan, collision, issues);
    expect(fix.kind === 'move' ? fix.object.id : fix.kind).toBe('eq_rack_1');
    if (fix.kind === 'none') throw new Error('вариант не запланирован');
    expect(findFix(plan, fix).ok).toBe(true);
  });
});

describe('силуэт постановки (#26)', () => {
  // Настенная камера физику не нарушает — принимается везде; рабочее место
  // встречает и свободные, и занятые места.
  test.each([['ot_workplace', [false, true]], ['ot_camera', [true]]])(
    'цвет силуэта типа %s совпадает с ответом хранилища при отпускании — на сетке точек по плану',
    (typeId, outcomes) => {
      const type = plan.catalog.objectTypes.find((entry) => entry.id === typeId);
      if (type === undefined) throw new Error(`нет типа ${typeId}`);
      const xs = plan.room.boundary.map((point) => point[0]);
      const ys = plan.room.boundary.map((point) => point[1]);
      const seen = new Set<boolean>();
      for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x += 1.3) {
        for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y += 1.3) {
          const object = placedObject(plan, type, [x, y]);
          if (object === null) throw new Error('постановка не дала объекта');
          const accepted = createPlanStore(plan).getState().dispatch({ type: 'object.put', object }).ok;
          expect(placementRefusal(plan, object) === null, `точка ${x}, ${y}`).toBe(accepted);
          seen.add(accepted);
        }
      }
      expect([...seen].sort()).toEqual(outcomes);
    },
  );

  test('слой заперт — отказ в силуэте и в хранилище', () => {
    const type = plan.catalog.objectTypes.find((entry) => entry.id === 'ot_workplace');
    const locked = { ...plan, layers: plan.layers.map((layer) => ({ ...layer, locked: true })) };
    const object = type === undefined ? null : placedObject(locked, type, [3, 3]);
    if (object === null) return;
    expect(placementRefusal(locked, object) === null).toBe(createPlanStore(locked).getState().dispatch({ type: 'object.put', object }).ok);
  });
});

describe('вложенная зона того же типа (#17)', () => {
  test('минимум комплектования у пустой вложенной зоны того же типа не требуется, у вложенной другого типа и у отдельной — требуется', () => {
    const rule = plan.catalog.rules.find((entry) => entry.kind === 'count' && entry.min !== null && entry.scope === 'inclusive');
    if (rule === undefined || rule.kind !== 'count') throw new Error('нет правила минимума с вложенными зонами');
    const parent = plan.zones.find((zone) => zone.typeId === rule.zoneTypeId);
    if (parent === undefined) throw new Error('нет зоны типа правила');
    const xs = parent.polygon.map((point) => point[0]);
    const ys = parent.polygon.map((point) => point[1]);
    const [x, y] = [Math.min(...xs), Math.min(...ys)];
    const ring: [number, number][] = [[x + 0.05, y + 0.05], [x + 0.15, y + 0.05], [x + 0.15, y + 0.15], [x + 0.05, y + 0.15]];
    const child: Zone = { ...parent, id: 'z_child', name: 'Вложенная', polygon: ring, parentId: parent.id };
    const below = (candidate: Zone) =>
      validatePlan({ ...plan, zones: [...plan.zones, candidate] }).filter(
        (found) => found.code === VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN && found.refs.some((ref) => ref.id === 'z_child'),
      );
    expect(below(child)).toEqual([]);
    expect(below({ ...child, parentId: null }).length).toBeGreaterThan(0);
    const otherType = plan.catalog.zoneTypes.find((type) => type.id !== parent.typeId)!;
    expect(below({ ...child, typeId: otherType.id }).every((found) => !found.refs.some((ref) => ref.id === 'z_child' && found.ruleIds?.includes(rule.id)))).toBe(true);
  });
});

describe('чек-лист комплектности (#31)', () => {
  test('красная строка есть ровно там, где проверка плана выдаёт находку по тому же правилу и зоне; числа — из инвентаризации', () => {
    const items = checklistItems(plan);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const rule = item.key.split(':')[0]!;
      const found = issues.some(
        (entry) =>
          (entry.code === VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN || entry.code === VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX) &&
          entry.refs.some((ref) => ref.kind === 'zone' && ref.id === item.zoneId) &&
          (entry as { ruleIds?: string[] }).ruleIds?.includes(rule) === true,
      );
      expect(item.met, item.key).toBe(!found);
    }
    // В примере есть и выполненные, и невыполненные строки: проверка не пустая.
    expect(new Set(items.map((item) => item.met))).toEqual(new Set([true, false]));
  });
});
