import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';
import { EMPTY_INDEX, ROOM_NAME, planIndex } from './plan-index';

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`Фикстура ${name} не разобралась`);
  return parsed.value;
}

describe('индекс «id → название» (D-202)', () => {
  const plan = loadPlan('nested.json');
  const index = planIndex(plan);

  test('объект, зона, слой, помещение и типы справочника называются из самого плана', () => {
    const object = plan.objects[0]!;
    const zone = plan.zones[0]!;
    const layer = plan.layers[0]!;
    expect(index.objectLabel(object.id)).toBe(object.label);
    expect(index.nameOf({ kind: 'object', id: object.id })).toBe(object.label);
    expect(index.zoneName(zone.id)).toBe(zone.name);
    expect(index.nameOf({ kind: 'zone', id: zone.id })).toBe(zone.name);
    expect(index.layerName(layer.id)).toBe(layer.name);
    expect(index.nameOf({ kind: 'room', id: plan.room.id })).toBe(ROOM_NAME);
    expect(index.objectTypeLabel(object.typeId)).toBe(
      plan.catalog.objectTypes.find((type) => type.id === object.typeId)?.label,
    );
    expect(index.zoneTypeLabel(zone.typeId)).toBe(
      plan.catalog.zoneTypes.find((type) => type.id === zone.typeId)?.label,
    );
  });

  test('чего нет — null, а не выдуманное имя; у стен и проёмов имени нет', () => {
    expect(index.objectLabel('eq_ghost')).toBeNull();
    expect(index.zoneName('z_ghost')).toBeNull();
    expect(index.nameOf({ kind: 'room', id: 'room_other' })).toBeNull();
    expect(index.nameOf({ kind: 'wall', id: plan.walls[0]?.id ?? 'w_1' })).toBeNull();
    expect(index.nameOf({ kind: 'opening', id: 'op_1' })).toBeNull();
    // Индекс над ничем — для панели без документа.
    expect(EMPTY_INDEX.nameOf({ kind: 'zone', id: plan.zones[0]!.id })).toBeNull();
    expect(EMPTY_INDEX.objectTypeLabel(plan.objects[0]!.typeId)).toBeNull();
  });

  test('индекс — снимок документа: переименование в плане видно только в новом индексе', () => {
    const zone = plan.zones[0]!;
    const renamed: PlanDocument = {
      ...plan,
      zones: plan.zones.map((entry) => (entry.id === zone.id ? { ...entry, name: 'Новое имя' } : entry)),
    };
    expect(index.zoneName(zone.id)).toBe(zone.name);
    expect(planIndex(renamed).zoneName(zone.id)).toBe('Новое имя');
  });
});
