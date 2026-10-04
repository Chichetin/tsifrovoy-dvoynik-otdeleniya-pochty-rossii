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
import { COMMAND_ISSUE_CODES, applyCommand, freshId, nextFreeId, takenIds } from './index';

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
  typeId: null,
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

describe('applyCommand: вложенность новой зоны (D-223)', () => {
  const drawn = (id: string, polygon: Zone['polygon'], parentId: string | null = null): Zone => ({
    id,
    typeId: 'zt_client',
    name: id,
    polygon,
    parentId,
    layerId: 'l_base',
    attributes: {},
  });

  test('зона, нарисованная целиком внутри другой, становится вложенной', () => {
    const plan = minimalPlan();

    const added = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn('z_corner', [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ]),
      }),
    );

    expect(added.zones.find((zone) => zone.id === 'z_corner')!.parentId).toBe('z_client');
    // Объект внутри уходит в самую глубокую зону, а не теряет её на двойной принадлежности.
    expect(added.objects[0]!.zoneId).toBe('z_corner');
  });

  test('из нескольких подходящих родителей берётся самый глубокий', () => {
    const plan = minimalPlan();
    const middle = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn(
          'z_middle',
          [
            [0.5, 0.5],
            [5, 0.5],
            [5, 5],
            [0.5, 5],
          ],
          'z_client',
        ),
      }),
    );

    const added = expectOk(
      applyCommand(middle, {
        type: 'zone.put',
        zone: drawn('z_corner', [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ]),
      }),
    );

    expect(added.zones.find((zone) => zone.id === 'z_corner')!.parentId).toBe('z_middle');
  });

  test('зона, пересекающая соседнюю лишь частично, остаётся без родителя', () => {
    const plan = minimalPlan();

    // z_client — 0..7 по X, зона уходит за неё до 9: это не вложение.
    const added = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn('z_half', [
          [6, 1],
          [9, 1],
          [9, 3],
          [6, 3],
        ]),
      }),
    );

    expect(added.zones.find((zone) => zone.id === 'z_half')!.parentId).toBeNull();
  });

  test('зона, совпавшая с существующей по границе, остаётся без родителя', () => {
    const plan = minimalPlan();

    const added = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn('z_same', [...plan.zones[0]!.polygon]),
      }),
    );

    expect(added.zones.find((zone) => zone.id === 'z_same')!.parentId).toBeNull();
  });

  test('зона в пустом месте остаётся без родителя', () => {
    const plan = minimalPlan();

    const added = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn('z_free', [
          [7.5, 1],
          [9.5, 1],
          [9.5, 3],
          [7.5, 3],
        ]),
      }),
    );

    expect(added.zones.find((zone) => zone.id === 'z_free')!.parentId).toBeNull();
  });

  test('заявленный родитель не переписывается геометрией', () => {
    const plan = minimalPlan();

    // Родитель указан руками, а геометрия его не подтверждает: команда
    // сохраняет выбор человека, о расхождении говорит «Проверка».
    const added = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn(
          'z_far',
          [
            [7.5, 1],
            [9.5, 1],
            [9.5, 3],
            [7.5, 3],
          ],
          'z_client',
        ),
      }),
    );

    expect(added.zones.find((zone) => zone.id === 'z_far')!.parentId).toBe('z_client');
  });

  test('у существующей зоны снятый родитель не возвращается сам', () => {
    const plan = minimalPlan();
    const added = expectOk(
      applyCommand(plan, {
        type: 'zone.put',
        zone: drawn('z_corner', [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ]),
      }),
    );
    const child = added.zones.find((zone) => zone.id === 'z_corner')!;

    // Карточка свойств: «без родителя» у уже существующей зоны — выбор человека.
    const detached = expectOk(
      applyCommand(added, { type: 'zone.put', zone: { ...child, parentId: null } }),
    );

    expect(detached.zones.find((zone) => zone.id === 'z_corner')!.parentId).toBeNull();
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
    // Существующий объект сначала удаляем: иначе новый справочник сделает
    // неполным его, и отклонена будет уже сама замена справочника.
    const empty = expectOk(applyCommand(plan, { type: 'object.delete', id: 'eq_work_1' }));
    const withRule = expectOk(
      applyCommand(empty, { type: 'catalog.replace', catalog: catalogWithShift(empty, false) }),
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

  test('смена типа сохраняет id, позицию и размер, а не подставляет размер нового типа', () => {
    const plan = minimalPlan();
    const catalog = {
      ...plan.catalog,
      objectTypes: [
        plan.catalog.objectTypes[0]!,
        {
          ...plan.catalog.objectTypes[0]!,
          id: 'ot_rack',
          label: 'Стеллаж',
          // Размеры и атрибуты у нового типа другие: если реализация возьмёт
          // их из справочника, тест это увидит.
          defaultSize_m: [0.4, 2] as [number, number],
          attributes: [
            { key: 'shelves', label: 'Полок', type: 'number' as const, required: true, default: 5 },
          ],
        },
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
    const after = retyped.objects[0]!;

    expect(after.id).toBe(before.id);
    expect(after.position).toEqual(before.position);
    expect(after.size_m).toEqual(before.size_m);
    expect(after.size_m).not.toEqual([0.4, 2]);
    expect(after.typeId).toBe('ot_rack');
    // Атрибуты перепроверены по новому типу: обязательный получил default,
    // прежний атрибут прошлого типа не удалён молча.
    expect(after.attributes.shelves).toBe(5);
    expect(after.attributes.inventoryNumber).toBe('ОПС-0001');
  });

  test('явный null не перезаписывается значением по умолчанию', () => {
    const plan = minimalPlan();
    const catalog = {
      ...plan.catalog,
      objectTypes: [
        {
          ...plan.catalog.objectTypes[0]!,
          attributes: [
            {
              key: 'shift',
              label: 'Смена',
              type: 'string' as const,
              required: false,
              default: 'день',
            },
          ],
        },
      ],
    };
    const withRule = expectOk(applyCommand(plan, { type: 'catalog.replace', catalog }));

    // Пользователь очистил необязательное поле: это значение, а не пропуск.
    const cleared = expectOk(
      applyCommand(withRule, {
        type: 'object.put',
        object: { ...objectAt('eq_new', [2, 4]), attributes: { shift: null } },
      }),
    );

    expect(cleared.objects.at(-1)!.attributes.shift).toBeNull();
  });

  test('обязательный атрибут, очищенный в null, отклоняется, а не молча заполняется', () => {
    const plan = minimalPlan();
    const catalog = {
      ...plan.catalog,
      objectTypes: [
        {
          ...plan.catalog.objectTypes[0]!,
          attributes: [
            {
              key: 'shift',
              label: 'Смена',
              type: 'string' as const,
              required: true,
              default: 'день',
            },
          ],
        },
      ],
    };
    const withRule = expectOk(applyCommand(plan, { type: 'catalog.replace', catalog }));

    const result = applyCommand(withRule, {
      type: 'object.put',
      object: { ...objectAt('eq_new', [2, 4]), attributes: { shift: null } },
    });

    expect(codes(result)).toContain(COMMAND_ISSUE_CODES.ATTRIBUTE_REQUIRED);
  });
});

describe('applyCommand: числовые инварианты документа', () => {
  test('угол нормализуется в [0, 360): документ должен пройти загрузку', () => {
    const plan = minimalPlan();

    const turned = expectOk(
      applyCommand(plan, {
        type: 'object.put',
        object: { ...plan.objects[0]!, rotation_deg: 360 },
      }),
    );
    const back = expectOk(
      applyCommand(plan, {
        type: 'object.put',
        object: { ...plan.objects[0]!, rotation_deg: -90 },
      }),
    );

    expect(turned.objects[0]!.rotation_deg).toBe(0);
    expect(back.objects[0]!.rotation_deg).toBe(270);
  });

  test('документ после нормализации угла действительно загружается', () => {
    const plan = minimalPlan();
    const turned = expectOk(
      applyCommand(plan, {
        type: 'object.put',
        object: { ...plan.objects[0]!, rotation_deg: 725 },
      }),
    );

    expect(parsePlanDocument(JSON.parse(JSON.stringify(turned)) as unknown).ok).toBe(true);
  });

  test('нулевой размер, отрицательная высота и бесконечная координата отклоняются', () => {
    const plan = minimalPlan();
    const base = plan.objects[0]!;

    expect(
      codes(applyCommand(plan, { type: 'object.put', object: { ...base, size_m: [0, 0.8] } })),
    ).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    expect(
      codes(applyCommand(plan, { type: 'object.put', object: { ...base, height_m: 0 } })),
    ).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    expect(
      codes(applyCommand(plan, { type: 'object.put', object: { ...base, base_m: -1 } })),
    ).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    expect(
      codes(
        applyCommand(plan, {
          type: 'object.put',
          object: { ...base, position: [Number.POSITIVE_INFINITY, 0] },
        }),
      ),
    ).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
  });

  test('помещение и зона из двух точек отклоняются', () => {
    const plan = minimalPlan();
    const twoPoints = [
      [0, 0],
      [10, 0],
    ] as PlanDocument['room']['boundary'];

    expect(codes(applyCommand(plan, { type: 'room.set', boundary: twoPoints }))).toContain(
      CONTRACT_ISSUE_CODES.SCHEMA_INVALID,
    );
    expect(
      codes(
        applyCommand(plan, {
          type: 'zone.put',
          zone: { ...plan.zones[0]!, polygon: twoPoints },
        }),
      ),
    ).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
  });

  test('корректная перерисовка помещения принимается и пересчитывает связи', () => {
    const plan = minimalPlan();

    // Помещение сжато так, что объект в точке (2,2) остаётся внутри зоны.
    const reshaped = expectOk(
      applyCommand(plan, {
        type: 'room.set',
        boundary: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
      }),
    );

    expect(reshaped.room.boundary).toHaveLength(4);
    expect(reshaped.objects[0]!.zoneId).toBe('z_client');
  });
});

describe('applyCommand: цикл вложенности и пересчёт', () => {
  test('замыкание parentId в цикл отклоняется', () => {
    const plan = minimalPlan();
    const child: Zone = {
      id: 'z_child',
      typeId: 'zt_client',
      name: 'Вложенная',
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
    const nested = expectOk(applyCommand(plan, { type: 'zone.put', zone: child }));

    // Родитель становится ребёнком своего ребёнка.
    const result = applyCommand(nested, {
      type: 'zone.put',
      zone: { ...nested.zones[0]!, parentId: 'z_child' },
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.ZONE_CYCLE);
  });

  test('relations.reconcile восстанавливает связи, заявленные файлом', () => {
    const plan = minimalPlan();
    // Импорт мог принести связь, которой геометрия не подтверждает.
    const claimed: PlanDocument = {
      ...plan,
      objects: [{ ...plan.objects[0]!, position: [9, 4], zoneId: 'z_client' }],
    };

    const reconciled = expectOk(applyCommand(claimed, { type: 'relations.reconcile' }));

    expect(reconciled.objects[0]!.zoneId).toBeNull();
  });
});

describe('applyCommand: стены, проёмы и справочник', () => {
  test('перестроение наружных стен учитывает id всех сущностей документа', () => {
    const plan = minimalPlan();
    plan.layers.push({ ...secondLayer, id: 'w_1' });
    plan.objects.push({ ...objectAt('w_2', [8, 4]), zoneId: null });
    plan.zones.push({ ...plan.zones[0]!, id: 'w_3' });
    plan.room.id = 'w_4';
    plan.openings[0]!.id = 'w_5';
    expect(parsePlanDocument(plan).ok).toBe(true);

    const changed = expectOk(applyCommand(plan, { type: 'room.set', boundary: plan.room.boundary }));

    expect(parsePlanDocument(changed).ok).toBe(true);
    expect(changed.layers).toEqual(plan.layers);
    expect(changed.openings[0]!.id).toBe('w_5');
  });

  test('перестроение наружных стен не выдаёт id, удалённый в этой сессии', () => {
    const plan = minimalPlan();
    const pentagon: [number, number][] = [[0, 0], [10, 0], [10, 8], [5, 10], [0, 8]];
    // Без сведений об удалённых первый свободный номер — w_1: он и уходит стене.
    const unaware = expectOk(applyCommand(plan, { type: 'room.set', boundary: pentagon }));
    expect(unaware.walls.map((wall) => wall.id)).toContain('w_1');
    // Удалённая в сессии перегородка w_1 (D-019): её номер пропускается, а в пакете тоже.
    const aware = expectOk(applyCommand(plan, { type: 'room.set', boundary: pentagon }, ['w_1']));
    expect(aware.walls.map((wall) => wall.id)).not.toContain('w_1');
    expect(aware.walls).toHaveLength(unaware.walls.length);
    const batched = expectOk(applyCommand(
      plan,
      { type: 'batch', commands: [{ type: 'room.set', boundary: pentagon }] },
      new Set(['w_1']),
    ));
    expect(batched.walls.map((wall) => wall.id)).not.toContain('w_1');
  });

  test.each(['opening.delete', 'wall.delete', 'room.set'] as const)(
    '%s не удаляет вход, указанный в правиле расстояния',
    (type) => {
      const plan = minimalPlan();
      plan.catalog.rules.push({
        id: 'r_entrance', kind: 'distance-to-entrance', source: 'team-assumption',
        rationale: 'Расстояние до выбранного входа', objectTypeId: 'ot_workplace',
        maxDistance_m: 3, entranceId: 'op_entrance',
      });
      expect(parsePlanDocument(plan).ok).toBe(true);
      const before = structuredClone(plan);
      const result = applyCommand(plan, type === 'room.set'
        ? { type, boundary: [[0, 0], [1, 0], [1, 1], [0, 1]] }
        : { type, id: type === 'wall.delete' ? 'w_north' : 'op_entrance' });

      expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
      expect(plan).toEqual(before);
    },
  );

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

  test('проём шире стены отклоняется: ширина — единственное поле, которым её правят', () => {
    const plan = minimalPlan(); // w_north: от (0, 8) до (10, 8) — 10 м
    const before = structuredClone(plan);

    const result = applyCommand(plan, {
      type: 'opening.put',
      opening: { ...plan.openings[0]!, width_m: 11 },
    });

    expect(codes(result)).toContain(COMMAND_ISSUE_CODES.OPENING_TOO_WIDE);
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain('/width_m');
    expect(plan).toEqual(before);
  });

  test('проём вровень со стеной проходит', () => {
    const plan = expectOk(
      applyCommand(minimalPlan(), {
        type: 'opening.put',
        opening: { ...minimalPlan().openings[0]!, offset_m: 0, width_m: 10 },
      }),
    );
    expect(plan.openings[0]?.width_m).toBe(10);
  });

  test('стена и проём добавляются и удаляются по отдельности', () => {
    let plan = expectOk(
      applyCommand(minimalPlan(), {
        type: 'wall.put',
        wall: { id: 'w_south', from: [0, 0], to: [10, 0], thickness_m: 0.2, height_m: 3 },
      }),
    );
    plan = expectOk(
      applyCommand(plan, {
        type: 'opening.put',
        opening: {
          id: 'op_window',
          wallId: 'w_south',
          offset_m: 2,
          width_m: 1.5,
          kind: 'window',
          sill_m: 0.9,
          height_m: 1.5,
        },
      }),
    );

    expect(plan.walls.map((wall) => wall.id)).toEqual(['w_north', 'w_south']);
    expect(plan.openings.map((opening) => opening.id)).toEqual(['op_entrance', 'op_window']);

    const cleaned = expectOk(applyCommand(plan, { type: 'opening.delete', id: 'op_window' }));

    expect(cleaned.openings.map((opening) => opening.id)).toEqual(['op_entrance']);
    expect(cleaned.walls).toHaveLength(2);
  });

  test('стена с нулевой толщиной отклоняется', () => {
    const result = applyCommand(minimalPlan(), {
      type: 'wall.put',
      wall: { id: 'w_thin', from: [0, 0], to: [1, 0], thickness_m: 0, height_m: 3 },
    });

    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
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

  test('справочник, делающий существующий объект неполным, отклоняется', () => {
    const plan = minimalPlan();
    // У eq_work_1 нет атрибута shift, а новый тип требует его без default:
    // иначе через catalog.replace получилось бы состояние, которое
    // object.put отклоняет.
    const catalog = {
      ...plan.catalog,
      objectTypes: [
        {
          ...plan.catalog.objectTypes[0]!,
          attributes: [
            { key: 'shift', label: 'Смена', type: 'string' as const, required: true },
          ],
        },
      ],
    };

    const result = applyCommand(plan, { type: 'catalog.replace', catalog });

    expect(codes(result)).toContain(COMMAND_ISSUE_CODES.ATTRIBUTE_REQUIRED);
  });

  test('справочник с default дозаполняет существующие объекты', () => {
    const plan = minimalPlan();
    const catalog = {
      ...plan.catalog,
      objectTypes: [
        {
          ...plan.catalog.objectTypes[0]!,
          attributes: [
            {
              key: 'shift',
              label: 'Смена',
              type: 'string' as const,
              required: true,
              default: 'день',
            },
          ],
        },
      ],
    };

    const updated = expectOk(applyCommand(plan, { type: 'catalog.replace', catalog }));

    expect(updated.objects[0]!.attributes.shift).toBe('день');
  });
});

describe('applyCommand: план и помещение', () => {
  test('plan.rename хранит название как набрано (пробел на конце — часть набора), пустое отклоняет', () => {
    const plan = minimalPlan();
    const renamed = expectOk(applyCommand(plan, { type: 'plan.rename', name: 'ОПС ' }));
    expect(renamed.name).toBe('ОПС ');
    expect(codes(applyCommand(plan, { type: 'plan.rename', name: '   ' }))).toContain(
      COMMAND_ISSUE_CODES.NAME_EMPTY,
    );
  });

  test('после room.setCeiling новый контур получает наружные стены высотой в потолок', () => {
    const plan = minimalPlan();
    const raised = expectOk(applyCommand(plan, { type: 'room.setCeiling', ceilingHeight_m: 3.6 }));
    const [a, b, c, d] = raised.room.boundary;
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('контур');
    // Вершина вставлена в середину первого ребра: контур другой, стены перестроены.
    const boundary = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number], b, c, d];
    const reshaped = expectOk(applyCommand(raised, { type: 'room.set', boundary }));
    expect(reshaped.walls.length).toBeGreaterThan(0);
    for (const wall of reshaped.walls) expect(wall.height_m).toBe(3.6);
  });

  test('room.setCeiling поднимает наружные стены и не трогает перегородки', () => {
    const plan = minimalPlan();
    const [a, b, c, d] = plan.room.boundary;
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('контур');
    const mid = (p: number[], q: number[]): [number, number] => [((p[0] ?? 0) + (q[0] ?? 0)) / 2, ((p[1] ?? 0) + (q[1] ?? 0)) / 2];
    const withWalls = expectOk(
      applyCommand(
        expectOk(applyCommand(plan, { type: 'wall.put', wall: { id: 'w_outer', from: a, to: b, thickness_m: 0.2, height_m: 2.5 } })),
        { type: 'wall.put', wall: { id: 'w_inner', from: mid(a, d), to: mid(b, c), thickness_m: 0.1, height_m: 2.2 } },
      ),
    );
    const raised = expectOk(applyCommand(withWalls, { type: 'room.setCeiling', ceilingHeight_m: 3.4 }));
    expect(raised.room.ceilingHeight_m).toBe(3.4);
    expect(raised.walls.find((w) => w.id === 'w_outer')?.height_m).toBe(3.4);
    expect(raised.walls.find((w) => w.id === 'w_inner')?.height_m).toBe(2.2);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codes(applyCommand(plan, { type: 'room.setCeiling', ceilingHeight_m: bad }))).toContain(
        COMMAND_ISSUE_CODES.CEILING_INVALID,
      );
    }
  });
});

describe('applyCommand: пакет команд (batch)', () => {
  test('шаги применяются по порядку, результат — один документ', () => {
    const plan = minimalPlan();
    const moved = expectOk(
      applyCommand(plan, {
        type: 'batch',
        commands: [
          { type: 'object.put', object: objectAt('eq_a', [2, 2]) },
          { type: 'object.put', object: objectAt('eq_b', [4, 2]) },
          { type: 'object.delete', id: 'eq_work_1' },
        ],
      }),
    );
    expect(moved.objects.map((object) => object.id).sort()).toEqual(['eq_a', 'eq_b']);
  });

  test('всё или ничего: отказ шага — отказ пакета с его кодом, исходный план не тронут', () => {
    const plan = minimalPlan();
    const result = applyCommand(plan, {
      type: 'batch',
      commands: [
        { type: 'object.put', object: objectAt('eq_a', [2, 2]) },
        { type: 'object.delete', id: 'eq_missing' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
    expect(plan.objects.map((object) => object.id)).toEqual(['eq_work_1']);
  });

  test('пустой пакет отклоняется: пустой шаг истории не нужен', () => {
    expect(codes(applyCommand(minimalPlan(), { type: 'batch', commands: [] }))).toContain(
      COMMAND_ISSUE_CODES.BATCH_EMPTY,
    );
  });

  test('вложенный пакет — тоже пакет', () => {
    const plan = minimalPlan();
    const result = expectOk(
      applyCommand(plan, {
        type: 'batch',
        commands: [{ type: 'batch', commands: [{ type: 'object.delete', id: 'eq_work_1' }] }],
      }),
    );
    expect(result.objects).toEqual([]);
  });
});

describe('выдача id (D-198)', () => {
  test('свежий id не совпадает ни с сущностью плана, ни с удалённым в этой сессии', () => {
    const plan = minimalPlan();
    const first = plan.objects[0]!;
    const withoutIt = expectOk(applyCommand(plan, { type: 'object.delete', id: first.id }));
    // Без учёта удалённых первый свободный номер — это как раз удалённый.
    expect(freshId('eq_', withoutIt)).toBe('eq_1');
    // С учётом — следующий: удалённый id не воскресает (D-019).
    expect(freshId('eq_', withoutIt, ['eq_1'])).toBe('eq_2');
    // Пространство id общее: занятый номер другого рода тоже пропускается.
    expect(takenIds(plan).has(plan.room.id)).toBe(true);
    expect(takenIds(plan).has(plan.layers[0]!.id)).toBe(true);
  });

  test('nextFreeId занимает выданный номер, чтобы цикл выдал разные', () => {
    const taken = new Set<string>(['w_2']);
    expect([nextFreeId('w_', taken), nextFreeId('w_', taken), nextFreeId('w_', taken)]).toEqual(['w_1', 'w_3', 'w_4']);
  });
});
