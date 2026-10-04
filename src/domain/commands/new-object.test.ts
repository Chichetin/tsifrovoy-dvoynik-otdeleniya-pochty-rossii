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
import { applyCommand, newObject } from './index';

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

describe('#27: замок объекта', () => {
  test.each(['move', 'rotate', 'resize', 'height', 'outline', 'delete', 'unlock-and-move'])('%s не обходит замок', (action) => {
    const object = { ...before.objects[0]!, locked: true };
    const plan = { ...before, objects: [object, ...before.objects.slice(1)] };
    const changed = { ...object };
    if (action === 'move' || action === 'unlock-and-move') changed.position = [object.position[0] + 1, object.position[1]];
    if (action === 'unlock-and-move') changed.locked = false;
    if (action === 'rotate') changed.rotation_deg += 30;
    if (action === 'resize') changed.size_m = [object.size_m[0] + 1, object.size_m[1]];
    if (action === 'height') changed.base_m += 1;
    if (action === 'outline') changed.outline = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]];
    const result = applyCommand(plan, action === 'delete' ? { type: 'object.delete', id: object.id } : { type: 'object.put', object: changed });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('OBJECT_LOCKED');
    expect(plan.objects[0]).toEqual(object);
  });

  test('название правится, замок снимается явно, затем объект снова двигается', () => {
    const object = { ...before.objects[0]!, locked: true };
    const plan = { ...before, objects: [object, ...before.objects.slice(1)] };
    const renamed = applyCommand(plan, { type: 'object.put', object: { ...object, label: 'Закреплённый стол' } });
    if (!renamed.ok) throw new Error('название не должно быть заблокировано');
    const unlocked = applyCommand(renamed.value, { type: 'object.put', object: { ...renamed.value.objects[0]!, locked: false } });
    if (!unlocked.ok) throw new Error('замок должен сниматься');
    const moved = applyCommand(unlocked.value, { type: 'object.put', object: { ...unlocked.value.objects[0]!, position: [2, 2] } });
    expect(moved.ok).toBe(true);
  });

  test('группа с запертым объектом отклоняется целиком', () => {
    const object = { ...before.objects[0]!, locked: true };
    const other = before.objects[1]!;
    const plan = { ...before, objects: [object, ...before.objects.slice(1)] };
    const result = applyCommand(plan, { type: 'batch', commands: [
      { type: 'object.delete', id: other.id }, { type: 'object.delete', id: object.id },
    ] });
    expect(result.ok).toBe(false);
    expect(plan.objects).toContain(other);
  });
});
