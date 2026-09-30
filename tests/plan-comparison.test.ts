import { describe, expect, test } from 'vitest';
import beforeJson from '../demo/before.json';
import afterJson from '../demo/after.json';
import minimalJson from '../src/contracts/fixtures/minimal.json';
import type { Opening, PlanDocument } from '../src/contracts/model';
import { decodePlan } from '../src/persistence/codec';
import { parsePlanDocument } from '../src/contracts/schema';
import { buildPlanComparison } from '../src/domain/plan-comparison';

function document(raw: unknown): PlanDocument {
  const result = decodePlan(JSON.stringify(raw));
  if (!result.ok) throw new Error('Демо не прошло настоящий codec');
  return result.value;
}

function minimal(): PlanDocument {
  const parsed = parsePlanDocument(minimalJson);
  if (!parsed.ok) throw new Error('minimal.json не разобрался');
  return parsed.value;
}

describe('сравнение с отдельной исходной версией', () => {
  test('реальный комплект: площади, количество, проверки и имена трёх изменений', () => {
    const before = document(beforeJson);
    const after = document(afterJson);
    const snapshots = JSON.stringify([before, after]);
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = Object.fromEntries(result.value.rows.map((row) => [row.metric, row]));
    expect(rows['area.free']?.before).toBeCloseTo(114.73, 2);
    expect(rows['area.free']?.after).toBeCloseTo(113.93, 2);
    expect(rows['area.free']?.delta).toBeCloseTo(-0.8, 6);
    expect(rows['equipment.count']).toMatchObject({ before: 53, after: 53, delta: 0 });
    expect(rows['issues.error']).toMatchObject({ before: 1, after: 0, delta: -1 });
    expect(rows['issues.warning']).toMatchObject({ before: 2, after: 0, delta: -2 });
    expect(result.value.related).toBe(true);
    expect(result.value.warning).toBeNull();
    expect(result.value.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: { kind: 'object', id: 'eq_54' }, kind: 'added', beforeName: null, afterName: 'Скамья ожидания 2' }),
      expect.objectContaining({ ref: { kind: 'object', id: 'eq_8' }, kind: 'removed', beforeName: 'Табло над зоной очереди', afterName: null }),
      expect.objectContaining({ ref: { kind: 'object', id: 'eq_1' }, kind: 'moved', beforeName: 'Терминал электронной очереди', afterName: 'Терминал электронной очереди' }),
    ]));
    expect(JSON.stringify([before, after])).toBe(snapshots);
  });

  test('разные планы с совпавшими локальными ID не получают выдуманные переносы', () => {
    const before = document(beforeJson);
    const after = { ...document(afterJson), id: 'unrelated-plan' };
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.related).toBe(false);
    expect(result.value.warning).toContain('разные ID планов');
    expect(result.value.changes).toBeNull();
    expect(result.value.rows.find((row) => row.metric === 'equipment.count')).toMatchObject({ before: 53, after: 53 });
  });

  test('одинаковый документ отличается от невозможности сопоставления', () => {
    const plan = document(afterJson);
    const result = buildPlanComparison(plan, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changes).toEqual([]);
    expect(result.value.rows.every((row) => row.delta === 0)).toBe(true);
  });

  test('переименование показывает оба имени, не объявляет предмет удалённым', () => {
    const before = document(afterJson);
    const after = structuredClone(before);
    after.objects[0]!.label = 'Новое имя терминала';
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changes).toEqual([{
      ref: { kind: 'object', id: before.objects[0]!.id }, kind: 'updated',
      beforeName: before.objects[0]!.label, afterName: 'Новое имя терминала',
    }]);
  });

  test.each(['before', 'after'] as const)('неизмеримая геометрия %s возвращает диагностику', (side) => {
    const before = document(beforeJson);
    const after = document(afterJson);
    (side === 'before' ? before : after).room.boundary = [[0, 0], [1, 0]];
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('находки и правила «было → стало» (#35)', () => {
  test('демо-пара: три находки закрыты, новых нет', () => {
    const before = document(beforeJson);
    const after = document(afterJson);
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolvedCodes = result.value.issueDeltas
      .filter((delta) => delta.status === 'resolved')
      .map((delta) => delta.issue.code)
      .sort();
    expect(resolvedCodes).toEqual(['RULE_COUNT_ABOVE_MAX', 'RULE_COUNT_BELOW_MIN', 'RULE_TOO_FAR_FROM_ENTRANCE']);
    expect(result.value.issueDeltas.some((delta) => delta.status === 'new')).toBe(false);
    const distanceFinding = result.value.issueDeltas.find((delta) => delta.issue.code === 'RULE_TOO_FAR_FROM_ENTRANCE');
    expect(distanceFinding?.issue.message).toContain('6,62');
  });

  test('демо-пара: правила справочника «было → стало» — терминал 6,62 → 2,25 м, скамьи 1 → 2, табло 2 → 1', () => {
    const before = document(beforeJson);
    const after = document(afterJson);
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byRule = (ruleId: string) => result.value.ruleEffects.filter((row) => row.ruleId === ruleId);

    const distance = byRule('rule_queue_terminal_entrance')[0];
    expect(distance).toMatchObject({ unit: 'm', source: 'organizer-material' });
    expect(distance?.before).toBeCloseTo(6.62, 2);
    expect(distance?.after).toBeCloseTo(2.25, 2);
    expect(distance?.sourceNote).toContain('материалы организаторов');
    expect(distance?.label).toContain('Терминал электронной очереди');

    const bench = byRule('rule_bench_min')[0];
    expect(bench).toMatchObject({ unit: 'count', before: 1, after: 2, source: 'team-assumption' });
    expect(bench?.sourceNote).toContain('не норматив Почты России');
    expect(bench?.label).toContain('Зона ожидания');

    const display = byRule('rule_info_display_max')[0];
    expect(display).toMatchObject({ unit: 'count', before: 2, after: 1, source: 'team-assumption' });
    expect(display?.label).toContain('Клиентский зал');
  });

  test('несвязанные планы: ни находок, ни чисел по правилам — как со списком изменений', () => {
    const before = document(beforeJson);
    const after = { ...document(afterJson), id: 'unrelated-plan' };
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issueDeltas).toEqual([]);
    expect(result.value.ruleEffects).toEqual([]);
  });

  test('план без находок не даёт строк правил', () => {
    const plan = minimal();
    const result = buildPlanComparison(plan, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issueDeltas).toEqual([]);
    expect(result.value.ruleEffects).toEqual([]);
  });

  test('новая зона без рабочего места: находка «появилась», значение «до» не выдумано (null)', () => {
    const before = minimal();
    const zone = before.zones[0];
    if (zone === undefined) throw new Error('в minimal.json нет зон');
    const after: PlanDocument = {
      ...before,
      zones: [
        ...before.zones,
        { ...zone, id: 'z_client_2', name: 'Второй клиентский зал', polygon: [[7, 0], [10, 0], [10, 8], [7, 8]] },
      ],
    };
    const result = buildPlanComparison(before, after);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const appeared = result.value.issueDeltas.find(
      (delta) => delta.status === 'new' && delta.issue.code === 'RULE_COUNT_BELOW_MIN'
        && delta.issue.refs.some((ref) => ref.kind === 'zone' && ref.id === 'z_client_2'),
    );
    expect(appeared).toBeDefined();
    const row = result.value.ruleEffects.find((entry) => entry.ruleId === 'rule_workplace_min' && entry.label.includes('Второй клиентский зал'));
    expect(row).toMatchObject({ unit: 'count', before: null, after: 0 });
  });

  test('несколько входов: расстояние берётся до ближайшего, не до первого/дальнего', () => {
    const base = minimal();
    const object = base.objects[0];
    if (object === undefined) throw new Error('в minimal.json нет объектов');
    const nearEntrance: Opening = {
      id: 'op_entrance_near', wallId: 'w_north', offset_m: 0, width_m: 1, kind: 'entrance', sill_m: 0, height_m: 2.1,
    };
    const withTwoEntrances: PlanDocument = {
      ...base,
      openings: [...base.openings, nearEntrance],
      catalog: {
        ...base.catalog,
        rules: [
          {
            id: 'rule_test_distance', kind: 'distance-to-entrance', source: 'organizer-material',
            rationale: 'Проверка выбора ближайшего входа.', objectTypeId: object.typeId, maxDistance_m: 0, entranceId: null,
          },
        ],
      },
    };
    const result = buildPlanComparison(withTwoEntrances, withTwoEntrances);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.value.ruleEffects.find((entry) => entry.ruleId === 'rule_test_distance');
    expect(row).toBeDefined();
    // Вход op_entrance стоит по центру стены (offset 4, ширина 1.2 → центр x=4.6);
    // добавленный op_entrance_near — у угла (offset 0, ширина 1 → центр x=0.5).
    // Объект в [2, 2]: до дальнего входа ~6.54 м, до ближнего ~6.18 м — берётся меньшее.
    const far = Math.hypot(object.position[0] - 4.6, object.position[1] - 8);
    const near = Math.hypot(object.position[0] - 0.5, object.position[1] - 8);
    expect(near).toBeLessThan(far);
    expect(row?.before).toBeCloseTo(near, 6);
    expect(row?.after).toBeCloseTo(near, 6);
  });
});
