import { describe, expect, test } from 'vitest';
import beforeJson from '../demo/before.json';
import afterJson from '../demo/after.json';
import type { PlanDocument } from '../src/contracts/model';
import { decodePlan } from '../src/persistence/codec';
import { buildPlanComparison } from '../src/domain/plan-comparison';

function document(raw: unknown): PlanDocument {
  const result = decodePlan(JSON.stringify(raw));
  if (!result.ok) throw new Error('Демо не прошло настоящий codec');
  return result.value;
}

describe('сравнение с отдельной исходной версией', () => {
  test('реальный комплект: площади, количество, проверки и имена двух изменений', () => {
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
    expect(rows['equipment.count']).toMatchObject({ before: 53, after: 54, delta: 1 });
    expect(rows['issues.error']).toMatchObject({ before: 1, after: 0, delta: -1 });
    expect(rows['issues.warning']).toMatchObject({ before: 1, after: 0, delta: -1 });
    expect(result.value.related).toBe(true);
    expect(result.value.warning).toBeNull();
    expect(result.value.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: { kind: 'object', id: 'eq_54' }, kind: 'added', beforeName: null, afterName: 'Скамья ожидания 2' }),
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
    expect(result.value.rows.find((row) => row.metric === 'equipment.count')).toMatchObject({ before: 53, after: 54 });
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
