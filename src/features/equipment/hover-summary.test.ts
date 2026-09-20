import { describe, expect, test } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { Issue } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { equipmentHoverSummary } from './hover-summary';

function plan() {
  const parsed = parsePlanDocument(nested);
  if (!parsed.ok) throw new Error('nested.json не разобрался');
  return parsed.value;
}

describe('подсказка объекта', () => {
  test('показывает имена вместе с id, инвентарный номер, размеры и поворот', () => {
    const document = plan();
    const source = document.objects[0]!;
    const object = {
      ...source,
      attributes: { ...source.attributes, inventoryNumber: ' ИНВ-42 ' },
      size_m: [1.25, 0.5] as [number, number],
      rotation_deg: 37,
    };
    const summary = equipmentHoverSummary(document, object, []);
    const type = document.catalog.objectTypes.find((entry) => entry.id === object.typeId)!;
    const zone = document.zones.find((entry) => entry.id === object.zoneId)!;

    expect(summary.title).toBe(object.label);
    expect(summary.lines).toContain(`Тип: ${type.label} (${type.id})`);
    expect(summary.lines).toContain(`ID: ${object.id}`);
    expect(summary.lines).toContain('Инв. №: ИНВ-42');
    expect(summary.lines).toContain(`Зона: ${zone.name} (${zone.id})`);
    expect(summary.lines).toContain('Размер: 1,25 × 0,5 м');
    expect(summary.lines).toContain('Поворот: 37°');
  });

  test('не прячет неизвестные id и ставит ошибки раньше предупреждений', () => {
    const document = plan();
    const object = {
      ...document.objects[0]!,
      typeId: 'ot_missing',
      zoneId: 'z_missing',
      attributes: { ...document.objects[0]!.attributes, inventoryNumber: null },
    };
    const issues: Issue[] = [
      { code: 'WARN', severity: 'warning', message: 'Предупреждение', refs: [{ kind: 'object', id: object.id }] },
      { code: 'OTHER', severity: 'error', message: 'Чужая ошибка', refs: [{ kind: 'object', id: 'other' }] },
      { code: 'ERROR', severity: 'error', message: 'Ошибка объекта', refs: [{ kind: 'object', id: object.id }] },
    ];

    const summary = equipmentHoverSummary(document, object, issues);
    expect(summary.lines).toContain('Тип: ot_missing');
    expect(summary.lines).toContain('Зона: z_missing');
    expect(summary.lines).toContain('Инв. №: —');
    expect(summary.lines.slice(-2)).toEqual([
      'Проверка: Ошибка объекта',
      'Проверка: Предупреждение',
    ]);
    expect(summary.lines.join('\n')).not.toContain('Чужая ошибка');
  });
});
