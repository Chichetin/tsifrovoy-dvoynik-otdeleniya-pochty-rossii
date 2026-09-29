import { describe, expect, test } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import { parsePlanDocument } from '../../contracts/schema';
import { HOVER_HINT, HOVER_TOOL_HINT, equipmentHoverSummary } from './hover-summary';

function plan() {
  const parsed = parsePlanDocument(nested);
  if (!parsed.ok) throw new Error('nested.json не разобрался');
  return parsed.value;
}

describe('подсказка объекта', () => {
  test('в режиме установки сначала направляет к инструменту выбора', () => {
    const object = plan().objects[0]!;
    expect(equipmentHoverSummary(object, false)).toEqual({ title: object.label, hint: HOVER_TOOL_HINT });
    expect(equipmentHoverSummary(object, true).hint).toBe(HOVER_HINT);
  });
  test('называет предмет и зовёт кликнуть за подробностями', () => {
    const document = plan();
    const object = document.objects[0]!;

    const summary = equipmentHoverSummary(object);

    expect(summary.title).toBe(object.label);
    expect(summary.hint).toBe(HOVER_HINT);
  });

  test('паспорт объекта в карточку не попадает — он в «Свойствах»', () => {
    const document = plan();
    const source = document.objects[0]!;
    const object = {
      ...source,
      attributes: { ...source.attributes, inventoryNumber: 'ИНВ-42' },
      size_m: [1.25, 0.5] as [number, number],
      rotation_deg: 37,
    };
    const zone = document.zones.find((entry) => entry.id === object.zoneId);

    const shown = Object.values(equipmentHoverSummary(object)).join('\n');

    // Ни типа, ни размеров, ни поворота, ни инвентарного номера, ни зоны.
    expect(shown).not.toContain(object.typeId);
    expect(shown).not.toContain(object.id);
    expect(shown).not.toContain('1,25');
    expect(shown).not.toContain('ИНВ-42');
    if (zone !== undefined) expect(shown).not.toContain(zone.name);
  });

  test('карточка — это ровно две строки: имя и подсказка', () => {
    const document = plan();

    const summary = equipmentHoverSummary(document.objects[0]!);

    expect(Object.keys(summary).sort()).toEqual(['hint', 'title']);
  });
});
