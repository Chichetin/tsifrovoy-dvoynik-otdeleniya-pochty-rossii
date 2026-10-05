import { describe, expect, test } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import { parsePlanDocument } from '../../contracts/schema';
import { applyCommand } from '../../domain/commands';
import { placeOptions, placeTargetOf } from './place-suggestion';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('Контрактный fixture minimal.json не разобрался');
const plan = parsed.value;

describe('#179: варианты «Предложить место»', () => {
  test('стоящий объект: до трёх переносов, последним «оставить как есть»; перенос — одна команда с тем же id', () => {
    const result = placeOptions(plan, { objectId: 'eq_work_1' });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { subject, options } = result.value;
    expect(subject).toMatchObject({ kind: 'object', id: 'eq_work_1', from: plan.objects[0]!.position });
    expect(options.length).toBeLessThanOrEqual(4);
    expect(options.at(-1)!.kind).toBe('keep');
    expect(options.at(-1)!.object).toBeNull();
    for (const option of options.filter((entry) => entry.kind === 'move')) {
      expect(option.command?.type).toBe('object.put');
      expect(option.object?.id).toBe('eq_work_1');
      expect(applyCommand(plan, option.command!).ok).toBe(true);
      expect(option.numbers.length).toBeGreaterThan(0);
      expect(option.reason).not.toContain('eq_');
    }
  });

  test('тип из библиотеки: варианты нового объекта и «Не добавлять» без призрака', () => {
    const result = placeOptions(plan, { typeId: 'ot_workplace' });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { subject, options } = result.value;
    expect(subject).toMatchObject({ kind: 'type', id: 'ot_workplace', from: null });
    expect(options.at(-1)).toMatchObject({ kind: 'keep', title: 'Не добавлять', object: null });
    for (const option of options.filter((entry) => entry.kind === 'add')) {
      expect(option.candidate).not.toBeNull();
      expect(option.object?.typeId).toBe('ot_workplace');
      expect(option.numbers.map((number) => number.label)).toContain('Свободно в помещении');
    }
  });

  test('нет объекта или типа — ошибка, а не пустой список', () => {
    expect(placeOptions(plan, { objectId: 'eq_none' }).ok).toBe(false);
    expect(placeOptions(plan, { typeId: 'ot_none' }).ok).toBe(false);
  });

  test('detail события: объект или тип, остальное не запрос', () => {
    expect(placeTargetOf({ objectId: 'eq_1' })).toEqual({ objectId: 'eq_1' });
    expect(placeTargetOf({ typeId: 'ot_1' })).toEqual({ typeId: 'ot_1' });
    expect(placeTargetOf({ objectId: '' })).toBeNull();
    expect(placeTargetOf(null)).toBeNull();
    expect(placeTargetOf('eq_1')).toBeNull();
  });
});
