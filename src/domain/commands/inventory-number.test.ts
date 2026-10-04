/**
 * D-310: the next free inventory number follows the plan's own series.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Attributes, Equipment, ObjectType, PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import {
  DEFAULT_INVENTORY_SERIES,
  applyCommand,
  carriesInventoryNumber,
  nextInventoryNumber,
  withInventoryNumber,
} from './index';

function readPlan(...path: string[]): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(join(process.cwd(), ...path), 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`${path.join('/')} не проходит схему`);
  return parsed.value;
}

const base = readPlan('src', 'contracts', 'fixtures', 'minimal.json');
const template = base.objects[0]!;

function object(id: string, attributes: Attributes, typeId = template.typeId): Equipment {
  return { ...template, id, typeId, attributes };
}

/** The minimal plan with its objects replaced by ones carrying `numbers`. */
function planWith(...numbers: (string | number | null)[]): PlanDocument {
  return {
    ...base,
    objects: numbers.map((number, index) =>
      object(`eq_${index + 1}`, number === null ? {} : { inventoryNumber: number }),
    ),
  };
}

const extraTypes: ObjectType[] = [
  { ...base.catalog.objectTypes[0]!, id: 'ot_mark', label: 'Отметка', physical: false },
  { ...base.catalog.objectTypes[0]!, id: 'ot_bare', label: 'Без номера', attributes: [] },
];
const catalog = { ...base.catalog, objectTypes: [...base.catalog.objectTypes, ...extraTypes] };

describe('nextInventoryNumber: серия плана (D-310)', () => {
  test('продолжает серию демо-плана: ИНВ-ДЕМО-053 → ИНВ-ДЕМО-054', () => {
    const demo = readPlan('demo', 'before.json');
    expect(nextInventoryNumber(demo)).toBe('ИНВ-ДЕМО-054');
  });

  test('пропуски не заполняет: после 001 и 005 — 006, а не 002', () => {
    expect(nextInventoryNumber(planWith('ИНВ-001', 'ИНВ-005'))).toBe('ИНВ-006');
  });

  test('удалённый объект из середины серии свой номер не отдаёт новому', () => {
    const plan = planWith('ИНВ-001', 'ИНВ-002', 'ИНВ-003');
    const deleted = { ...plan, objects: plan.objects.filter((entry) => entry.id !== 'eq_2') };
    expect(nextInventoryNumber(deleted)).toBe('ИНВ-004');
  });

  test('ширина — по наибольшему номеру серии, переход разряда не обрезается', () => {
    expect(nextInventoryNumber(planWith('ОПС-0007'))).toBe('ОПС-0008');
    expect(nextInventoryNumber(planWith('ОПС-7', 'ОПС-12'))).toBe('ОПС-13');
    expect(nextInventoryNumber(planWith('ОПС-998', 'ОПС-999'))).toBe('ОПС-1000');
  });

  test('номер-число и строка из цифр — серия без префикса', () => {
    expect(nextInventoryNumber(planWith(1024, '1030'))).toBe('1031');
  });

  test('серия — префикс большинства; при равенстве — встреченный первым', () => {
    expect(nextInventoryNumber(planWith('А-9', 'Б-1', 'Б-2'))).toBe('Б-3');
    expect(nextInventoryNumber(planWith('А-9', 'Б-1'))).toBe('А-10');
  });

  test('номера без цифр в конце серию не задают и не мешают', () => {
    expect(nextInventoryNumber(planWith('б/н', 'ИНВ-ДЕМО-003', 'СКЛАД'))).toBe('ИНВ-ДЕМО-004');
  });

  test('план без номеров начинает серию команды ИНВ-0001', () => {
    expect(DEFAULT_INVENTORY_SERIES).toEqual({ prefix: 'ИНВ-', width: 4 });
    expect(nextInventoryNumber(planWith(null, '  ', 'б/н'))).toBe('ИНВ-0001');
    expect(nextInventoryNumber({ ...base, objects: [] })).toBe('ИНВ-0001');
  });

  test('подряд из одного набора — разные номера, набор пополняется', () => {
    const plan = planWith('ИНВ-010');
    const taken = new Set<string>();
    expect([nextInventoryNumber(plan, taken), nextInventoryNumber(plan, taken)]).toEqual([
      'ИНВ-011',
      'ИНВ-012',
    ]);
    expect([...taken]).toEqual(['ИНВ-011', 'ИНВ-012']);
  });

  test('номер, который уже стоит вне серии, не выдаётся повторно', () => {
    // «1», «2» — серия без префикса; «3» вписан строкой с пробелами.
    expect(nextInventoryNumber(planWith(1, 2, ' 3 '))).toBe('4');
  });
});

describe('withInventoryNumber: при создании объекта', () => {
  const plan = { ...planWith('ИНВ-004'), catalog };

  test('физический тип с атрибутом получает следующий номер', () => {
    const placed = withInventoryNumber(plan, object('eq_new', {}));
    expect(placed.attributes.inventoryNumber).toBe('ИНВ-005');
  });

  test('пустой номер (null, пробелы) заменяется, вписанный — остаётся', () => {
    expect(withInventoryNumber(plan, object('eq_new', { inventoryNumber: null })).attributes.inventoryNumber).toBe(
      'ИНВ-005',
    );
    expect(withInventoryNumber(plan, object('eq_new', { inventoryNumber: '  ' })).attributes.inventoryNumber).toBe(
      'ИНВ-005',
    );
    const own = object('eq_new', { inventoryNumber: 'СВОЙ-1' });
    expect(withInventoryNumber(plan, own)).toBe(own);
  });

  test('нефизический тип, тип без атрибута и неизвестный тип номер не получают', () => {
    for (const typeId of ['ot_mark', 'ot_bare', 'ot_unknown']) {
      const placed = object('eq_new', {}, typeId);
      expect(withInventoryNumber(plan, placed)).toBe(placed);
      expect(carriesInventoryNumber(catalog, typeId)).toBe(false);
    }
    expect(carriesInventoryNumber(catalog, template.typeId)).toBe(true);
  });

  test('номер ставится той же командой object.put, что и объект', () => {
    const placed = withInventoryNumber(plan, { ...object('eq_new', {}), position: [2, 4] });
    const result = applyCommand(plan, { type: 'object.put', object: placed });
    if (!result.ok) throw new Error(result.issues.map((entry) => entry.code).join(', '));
    expect(result.value.objects.find((entry) => entry.id === 'eq_new')?.attributes.inventoryNumber).toBe('ИНВ-005');
  });
});
