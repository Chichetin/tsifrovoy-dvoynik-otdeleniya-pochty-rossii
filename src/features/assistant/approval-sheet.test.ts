/**
 * #35: the approval sheet reads only what `buildPlanComparison` and the
 * deterministic `compare` scenario already calculate. No fixture here invents
 * a number — every assertion is the demo pair the ZIP ships, the same one
 * `tests/demo.test.ts` and `comparison-file.spec.ts` check.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { decodePlan } from '../../persistence/codec';
import { readPlanFile } from '../../persistence/format';
import { buildApprovalSheet } from './approval-sheet';

function demoPlan(name: string): PlanDocument {
  const opened = readPlanFile(readFileSync(join(process.cwd(), 'demo', name), 'utf8'));
  if (!opened.ok) throw new Error(`${name} не открылся`);
  return opened.value.plan;
}

function fixture(name: string): PlanDocument {
  const decoded = decodePlan(readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8'));
  if (!decoded.ok) throw new Error(name);
  return decoded.value;
}

const before = demoPlan('before.json');
const after = demoPlan('after.json');

describe('buildApprovalSheet', () => {
  test('числа эффекта — из расчёта demo-пары, как в demo/effect.md', () => {
    const sheet = buildApprovalSheet(before, after);
    if (!sheet.ok) throw new Error(sheet.issues.map((i) => i.message).join(' '));
    const row = (metric: string) => sheet.value.comparison.rows.find((r) => r.metric === metric)!;
    expect(row('area.free').before).toBeCloseTo(114.73, 2);
    expect(row('area.free').after).toBeCloseTo(113.93, 2);
    expect(row('equipment.count').before).toBe(53);
    expect(row('equipment.count').after).toBe(53);
    expect(row('issues.error').before).toBe(1);
    expect(row('issues.error').after).toBe(0);
    expect(row('issues.warning').before).toBe(2);
    expect(row('issues.warning').after).toBe(0);
  });

  test('изменения перечисляют добавленный, удалённый и перемещённый объект по названию', () => {
    const sheet = buildApprovalSheet(before, after);
    if (!sheet.ok) throw new Error('сравнение не построилось');
    const changes = sheet.value.comparison.changes ?? [];
    const added = changes.find((c) => c.ref.id === 'eq_54');
    const removed = changes.find((c) => c.ref.id === 'eq_8');
    const moved = changes.find((c) => c.ref.id === 'eq_1');
    expect(added?.kind).toBe('added');
    expect(added?.afterName).toBe('Скамья ожидания 2');
    expect(removed?.kind).toBe('removed');
    expect(removed?.beforeName).toBe('Табло над зоной очереди');
    expect(moved?.kind).toBe('moved');
    expect(moved?.afterName).toBe('Терминал электронной очереди');
  });

  test('картинки «до» и «после» не перепутаны и без XML-пролога', () => {
    const sheet = buildApprovalSheet(before, after);
    if (!sheet.ok) throw new Error('сравнение не построилось');
    expect(sheet.value.beforeSvg.startsWith('<svg')).toBe(true);
    expect(sheet.value.afterSvg.startsWith('<svg')).toBe(true);
    // eq_8 (табло) существует только «до», eq_54 (вторая скамья) — только «после».
    expect(sheet.value.beforeSvg).toContain('data-id="eq_8"');
    expect(sheet.value.afterSvg).not.toContain('data-id="eq_8"');
    expect(sheet.value.afterSvg).toContain('data-id="eq_54"');
    expect(sheet.value.beforeSvg).not.toContain('data-id="eq_54"');
  });

  test('допущения и ограничения — из расчёта, не перепутаны местами', () => {
    const sheet = buildApprovalSheet(before, after);
    if (!sheet.ok) throw new Error('сравнение не построилось');
    expect(sheet.value.assumptions.length).toBeGreaterThan(0);
    expect(sheet.value.assumptions.some((line) => line.includes('площад'))).toBe(true);
    expect(sheet.value.limitations.length).toBeGreaterThan(0);
    expect(sheet.value.limitations.some((line) => line.includes('площад'))).toBe(false);
  });

  test('невычислимая геометрия «до» — отказ, а не выдуманные числа', () => {
    const broken: PlanDocument = {
      ...before,
      room: {
        ...before.room,
        boundary: [
          [0, 0],
          [4, 4],
          [4, 0],
          [0, 4],
        ],
      },
    };
    const sheet = buildApprovalSheet(broken, after);
    expect(sheet.ok).toBe(false);
  });

  test('несвязанные планы: показатели считаются, список изменений — null', () => {
    const other = fixture('minimal.json');
    const sheet = buildApprovalSheet(other, after);
    if (!sheet.ok) throw new Error('сравнение не построилось');
    expect(sheet.value.comparison.related).toBe(false);
    expect(sheet.value.comparison.changes).toBeNull();
    expect(sheet.value.comparison.warning).not.toBeNull();
  });
});
