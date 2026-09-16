/**
 * S01 acceptance, part one: applyCommand as a pure function. Structural
 * invariants are refused, geometry mistakes are kept as a diagnosable state.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Equipment, Layer, PlanDocument, Result, Zone } from '../../contracts/model';
import { CONTRACT_ISSUE_CODES } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { COMMAND_ISSUE_CODES, applyCommand } from './index';

function minimalPlan(): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', 'minimal.json');
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error('fixture minimal.json не проходит схему');
  return parsed.value;
}

function codes(result: Result<PlanDocument>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function expectOk(result: Result<PlanDocument>): PlanDocument {
  if (!result.ok) throw new Error(`команда отклонена: ${codes(result).join(', ')}`);
  return result.value;
}

const secondLayer: Layer = {
  id: 'l_extra',
  name: 'Дополнительный',
  visible: true,
  locked: false,
  order: 1,
};

function objectAt(id: string, position: [number, number]): Equipment {
  return {
    id,
    typeId: 'ot_workplace',
    label: 'Рабочее место',
    position,
    size_m: [1.4, 0.8],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.75,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
  };
}

describe('applyCommand: структурные инварианты', () => {
  test('ссылка на несуществующий слой отклоняется', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, {
      type: 'object.put',
      object: { ...objectAt('eq_new', [2, 4]), layerId: 'l_missing' },
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
  });

  test('неизвестный typeId отклоняется: справочник — источник типов', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, {
      type: 'object.put',
      object: { ...objectAt('eq_new', [2, 4]), typeId: 'ot_unknown' },
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
  });

  test('чужой id в put отклоняется: пространство id плана общее', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, {
      type: 'object.put',
      object: objectAt('z_client', [2, 4]),
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.DUPLICATE_ID);
  });

  test('последний слой удалить нельзя', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, { type: 'layer.delete', id: 'l_base', moveTo: 'l_base' });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.NO_LAYERS);
  });

  test('удаление несуществующей сущности отклоняется', () => {
    const result = applyCommand(minimalPlan(), { type: 'object.delete', id: 'eq_gone' });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
  });
});

describe('applyCommand: слои', () => {
  test('удаление слоя переносит зоны и объекты в указанный слой', () => {
    let plan = expectOk(applyCommand(minimalPlan(), { type: 'layer.put', layer: secondLayer }));
    plan = expectOk(
      applyCommand(plan, {
        type: 'object.put',
        object: { ...objectAt('eq_new', [2, 4]), layerId: 'l_extra' },
      }),
    );

    plan = expectOk(applyCommand(plan, { type: 'layer.delete', id: 'l_base', moveTo: 'l_extra' }));

    expect(plan.layers.map((layer) => layer.id)).toEqual(['l_extra']);
    expect(plan.zones.every((zone) => zone.layerId === 'l_extra')).toBe(true);
    expect(plan.objects.every((object) => object.layerId === 'l_extra')).toBe(true);
  });

  test('перенос в несуществующий слой отклоняется', () => {
    const plan = expectOk(applyCommand(minimalPlan(), { type: 'layer.put', layer: secondLayer }));
    const result = applyCommand(plan, { type: 'layer.delete', id: 'l_base', moveTo: 'l_gone' });

    expect(codes(result)).toContain(COMMAND_ISSUE_CODES.MOVE_TARGET_INVALID);
  });

  test('запертый слой не принимает правку своего содержимого', () => {
    const base = minimalPlan();
    const locked = expectOk(
      applyCommand(base, {
        type: 'layer.put',
        layer: { ...base.layers[0]!, locked: true },
      }),
    );

    const moved = applyCommand(locked, {
      type: 'object.put',
      object: { ...locked.objects[0]!, position: [5, 5] },
    });
    const removed = applyCommand(locked, { type: 'object.delete', id: 'eq_work_1' });

    expect(codes(moved)).toContain(COMMAND_ISSUE_CODES.LAYER_LOCKED);
    expect(codes(removed)).toContain(COMMAND_ISSUE_CODES.LAYER_LOCKED);
  });

  test('сам слой разблокировать можно: запрет касается содержимого', () => {
    const base = minimalPlan();
    const locked = expectOk(
      applyCommand(base, { type: 'layer.put', layer: { ...base.layers[0]!, locked: true } }),
    );
    const unlocked = applyCommand(locked, {
      type: 'layer.put',
      layer: { ...base.layers[0]!, locked: false },
    });

    expect(unlocked.ok).toBe(true);
  });
});

describe('applyCommand: зоны и связи', () => {
  test('перемещение объекта пересчитывает zoneId', () => {
    const plan = minimalPlan();
    expect(plan.objects[0]!.zoneId).toBe('z_client');

    // x = 9 лежит вне зоны z_client (0..7), но внутри помещения (0..10).
    const moved = expectOk(
      applyCommand(plan, {
        type: 'object.put',
        object: { ...plan.objects[0]!, position: [9, 4] },
      }),
    );

    expect(moved.objects[0]!.zoneId).toBeNull();
  });

  test('удаление зоны переподчиняет детей её родителю', () => {
    const plan = minimalPlan();
    const child: Zone = {
      id: 'z_queue',
      typeId: 'zt_client',
      name: 'Очередь',
      polygon: [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      parentId: 'z_client',
      layerId: 'l_base',
      attributes: {},
    };
    const withChild = expectOk(applyCommand(plan, { type: 'zone.put', zone: child }));

    const withoutParent = expectOk(applyCommand(withChild, { type: 'zone.delete', id: 'z_client' }));

    expect(withoutParent.zones.map((zone) => zone.id)).toEqual(['z_queue']);
    expect(withoutParent.zones[0]!.parentId).toBeNull();
  });

  test('самопересечение зоны сохраняется, но связи обнуляются', () => {
    const plan = minimalPlan();
    const bowtie: Zone = {
      ...plan.zones[0]!,
      polygon: [
        [0, 0],
        [7, 8],
        [7, 0],
        [0, 8],
      ],
    };

    const broken = expectOk(applyCommand(plan, { type: 'zone.put', zone: bowtie }));

    expect(broken.zones[0]!.polygon).toEqual(bowtie.polygon);
    expect(broken.objects[0]!.zoneId).toBeNull();
  });
});

describe('applyCommand: атрибуты по типу объекта', () => {
  function catalogWithShift(plan: PlanDocument, withDefault: boolean) {
    return {
      ...plan.catalog,
      objectTypes: [
        {
          ...plan.catalog.objectTypes[0]!,
          attributes: [
            withDefault
              ? {
                  key: 'shift',
                  label: 'Смена',
                  type: 'string' as const,
                  required: true,
                  default: 'день',
                }
              : { key: 'shift', label: 'Смена', type: 'string' as const, required: true },
          ],
        },
      ],
    };
  }

  test('обязательный атрибут без значения и без default отклоняет команду', () => {
    const plan = minimalPlan();
    const withRule = expectOk(
      applyCommand(plan, { type: 'catalog.replace', catalog: catalogWithShift(plan, false) }),
    );

    const result = applyCommand(withRule, {
      type: 'object.put',
      object: { ...objectAt('eq_new', [2, 4]), attributes: {} },
    });

    expect(codes(result)).toContain(COMMAND_ISSUE_CODES.ATTRIBUTE_REQUIRED);
  });

  test('обязательный атрибут с default подставляется', () => {
    const plan = minimalPlan();
    const withRule = expectOk(
      applyCommand(plan, { type: 'catalog.replace', catalog: catalogWithShift(plan, true) }),
    );

    const placed = expectOk(
      applyCommand(withRule, {
        type: 'object.put',
        object: { ...objectAt('eq_new', [2, 4]), attributes: {} },
      }),
    );

    expect(placed.objects.at(-1)!.attributes.shift).toBe('день');
  });

  test('атрибут не того типа отклоняется, а неизвестный сохраняется', () => {
    const plan = minimalPlan();
    const wrongType = applyCommand(plan, {
      type: 'object.put',
      object: { ...objectAt('eq_new', [2, 4]), attributes: { inventoryNumber: 42 } },
    });
    expect(codes(wrongType)).toContain(COMMAND_ISSUE_CODES.ATTRIBUTE_TYPE);

    const unknown = expectOk(
      applyCommand(plan, {
        type: 'object.put',
        object: { ...objectAt('eq_new', [2, 4]), attributes: { somethingNew: 'сохранить' } },
      }),
    );
    expect(unknown.objects.at(-1)!.attributes.somethingNew).toBe('сохранить');
  });

  test('смена типа сохраняет id, позицию и размер', () => {
    const plan = minimalPlan();
    const catalog = {
      ...plan.catalog,
      objectTypes: [
        plan.catalog.objectTypes[0]!,
        { ...plan.catalog.objectTypes[0]!, id: 'ot_rack', label: 'Стеллаж' },
      ],
    };
    const withTypes = expectOk(applyCommand(plan, { type: 'catalog.replace', catalog }));
    const before = withTypes.objects[0]!;

    const retyped = expectOk(
      applyCommand(withTypes, {
        type: 'object.put',
        object: { ...before, typeId: 'ot_rack' },
      }),
    );

    expect(retyped.objects[0]!.id).toBe(before.id);
    expect(retyped.objects[0]!.position).toEqual(before.position);
    expect(retyped.objects[0]!.size_m).toEqual(before.size_m);
    expect(retyped.objects[0]!.typeId).toBe('ot_rack');
  });
});

describe('applyCommand: стены, проёмы и справочник', () => {
  test('удаление стены удаляет её проёмы одной операцией', () => {
    const plan = expectOk(applyCommand(minimalPlan(), { type: 'wall.delete', id: 'w_north' }));

    expect(plan.walls).toEqual([]);
    expect(plan.openings).toEqual([]);
  });

  test('проём без стены отклоняется', () => {
    const result = applyCommand(minimalPlan(), {
      type: 'opening.put',
      opening: {
        id: 'op_new',
        wallId: 'w_missing',
        offset_m: 1,
        width_m: 1,
        kind: 'door',
        sill_m: 0,
        height_m: 2,
      },
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
  });

  test('несогласованный справочник отклоняется проверкой самого справочника', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, {
      type: 'catalog.replace',
      catalog: { ...plan.catalog, objectTypes: [] },
    });

    // Правило ссылается на исчезнувший тип: об этом сообщает validateCatalog
    // своим кодом, до проверки использования типов в плане.
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('UNKNOWN_TYPE_REF');
  });

  test('согласованный справочник без используемого планом типа отклоняется', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, {
      type: 'catalog.replace',
      catalog: { ...plan.catalog, objectTypes: [], rules: [] },
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
  });
});
