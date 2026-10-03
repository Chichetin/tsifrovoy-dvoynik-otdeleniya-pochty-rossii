/**
 * #68: every way a new object enters the plan gives it the next inventory
 * number of the plan's series (D-310). Copies keep an empty number (D-311) —
 * they do not go through these functions.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { planDocumentSchema } from '../../contracts/schema';
import { calculateAdvice, candidateObjectForInsert } from '../advice';
import { findObjectType } from '../catalog';
import { newObject } from './index';

const before = planDocumentSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')),
) as PlanDocument;

describe('#68: новый объект получает следующий инвентарный номер', () => {
  test('библиотека и «Своя фигура»: newObject', () => {
    const bench = findObjectType(before.catalog, 'ot_bench');
    if (bench === null) throw new Error('ot_bench пропал из демо-плана');

    const object = newObject(before, bench, { position: [2.2, 2], rotation_deg: 0 }, []);

    expect(object?.attributes.inventoryNumber).toBe('ИНВ-ДЕМО-054');
    expect(before.objects.some((entry) => entry.id === object?.id)).toBe(false);
  });

  test('вставка варианта ассистента: candidateObjectForInsert', () => {
    const advice = calculateAdvice(before, { scenario: 'place', typeId: 'ot_bench', zoneId: null });
    if (!advice.ok) throw new Error('расчёт размещения не удался');
    const candidate = advice.value[0]?.candidates[0];
    if (candidate === undefined) throw new Error('расчёт не предложил ни одного варианта');

    const object = candidateObjectForInsert(before, candidate, []);

    expect(object.attributes.inventoryNumber).toBe('ИНВ-ДЕМО-054');
  });
});
