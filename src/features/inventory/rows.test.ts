/**
 * M02 (rows): подготовка строк перечня — имена, сводка по типам, фильтр.
 *
 * Проверяется ровно то, чего не видно в браузере: откуда берётся название
 * (из документа, а не из второй копии справочника), что происходит с
 * неизвестным `id` и по каким словам находится объект. Числа сюда приходят
 * из `buildInventory` — здесь их не считают, а группируют.
 */

import { describe, expect, test } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { Inventory, PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { buildInventory } from '../../domain/inventory';
import {
  absentTypes,
  display,
  filterObjectRows,
  namingOf,
  type Naming,
  objectRows,
  RAW_IDS,
  typeSummary,
  typesWord,
  zoneSummary,
} from './rows';

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
/** Две зоны верхнего уровня, вложенная зона ожидания, два объекта. */
const plan: PlanDocument = parsed.value;
const inventory = buildInventory(plan);
const naming = namingOf(plan);

/** Первый элемент там, где его отсутствие — уже провал теста. */
function first<T>(items: T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error('ожидался хотя бы один элемент');
  return head;
}

describe('имена по документу', () => {
  test('тип и зона объекта названы справочником и списком зон плана', () => {
    const rows = objectRows(inventory, naming);

    expect(rows.map((row) => [row.id, row.typeLabel, row.zoneName])).toEqual([
      ['eq_work_1', 'Рабочее место', 'Клиентская зона'],
      ['eq_bench_1', 'Место ожидания', 'Зона ожидания'],
    ]);
  });

  test('строки идут в порядке документа', () => {
    expect(objectRows(inventory, naming).map((row) => row.id)).toEqual(
      plan.objects.map((object) => object.id),
    );
  });

  test('неизвестный тип и пропавшая зона оставляют сырой id, а не пустую ячейку', () => {
    const broken: PlanDocument = {
      ...plan,
      objects: [{ ...first(plan.objects), typeId: 'ot_ghost', zoneId: 'z_ghost' }],
    };
    const row = first(objectRows(buildInventory(broken), namingOf(broken)));

    expect(row.typeLabel).toBeNull();
    expect(row.zoneName).toBeNull();
    expect(display(row.typeLabel, row.typeId)).toBe('ot_ghost');
    expect(display(row.zoneName, row.zoneId ?? '—')).toBe('z_ghost');
  });

  test('объект вне зон не получает названия зоны', () => {
    const loose: PlanDocument = { ...plan, objects: [{ ...first(plan.objects), zoneId: null }] };
    const row = first(objectRows(buildInventory(loose), namingOf(loose)));

    expect(row.zoneId).toBeNull();
    expect(row.zoneName).toBeNull();
  });

  test('без документа панель показывает id: названий нет, но строки есть', () => {
    const rows = objectRows(inventory, RAW_IDS);

    expect(rows.map((row) => row.typeLabel)).toEqual([null, null]);
    expect(rows.map((row) => display(row.typeLabel, row.typeId))).toEqual([
      'ot_workplace',
      'ot_bench',
    ]);
  });

  test('display подставляет id только при отсутствии имени', () => {
    expect(display('Клиентская зона', 'z_client')).toBe('Клиентская зона');
    expect(display(null, 'z_client')).toBe('z_client');
  });
});

describe('сводка по типам', () => {
  test('считает только размещённые типы и совпадает с числом строк', () => {
    const summary = typeSummary(inventory, naming);

    expect(summary).toEqual([
      { typeId: 'ot_bench', label: 'Место ожидания', count: 1 },
      { typeId: 'ot_workplace', label: 'Рабочее место', count: 1 },
    ]);
    expect(summary.reduce((sum, row) => sum + row.count, 0)).toBe(inventory.rows.length);
  });

  test('тип из справочника без объектов в сводку не попадает, но пересчитан отдельно', () => {
    const empty: Inventory = { ...inventory, byType: { ...inventory.byType, ot_camera: 0 } };

    expect(typeSummary(empty, naming).map((row) => row.typeId)).not.toContain('ot_camera');
    expect(absentTypes(empty)).toBe(1);
    expect(absentTypes(inventory)).toBe(0);
  });

  test('порядок — по убыванию количества, при равенстве по названию', () => {
    const many: Inventory = {
      ...inventory,
      byType: { ot_workplace: 2, ot_bench: 5, ot_ghost: 2 },
    };

    // Сравниваются показанные названия: у `ot_ghost` имени нет, и в сравнение
    // идёт сам id — в русском порядке кириллица раньше латиницы.
    expect(typeSummary(many, naming).map((row) => [row.typeId, row.count])).toEqual([
      ['ot_bench', 5],
      ['ot_workplace', 2],
      ['ot_ghost', 2],
    ]);
  });

  test('при равном количестве порядок задаёт название, а не ключ справочника', () => {
    const tie: Inventory = { ...inventory, byType: { ot_a: 1, ot_b: 1 } };
    const labels: Naming = {
      typeLabel: (typeId) => (typeId === 'ot_a' ? 'Яблоко' : 'Арбуз'),
      zoneName: () => null,
    };

    // По id порядок был бы «ot_a, ot_b», по названиям он обратный.
    expect(typeSummary(tie, labels).map((row) => [row.typeId, row.label])).toEqual([
      ['ot_b', 'Арбуз'],
      ['ot_a', 'Яблоко'],
    ]);
  });
});

describe('подпись о неразмещённых типах', () => {
  test('склонение по числу, а не «1 типов»', () => {
    expect([1, 2, 4, 5, 11, 14, 21, 22, 25, 101, 112].map(typesWord)).toEqual([
      'тип',
      'типа',
      'типа',
      'типов',
      'типов',
      'типов',
      'тип',
      'типа',
      'типов',
      'тип',
      'типов',
    ]);
  });
});

describe('сводка по зонам', () => {
  test('имя зоны, свои объекты и объекты с вложенными', () => {
    expect(zoneSummary(inventory, naming)).toEqual([
      { zoneId: 'z_client', name: 'Клиентская зона', direct: 1, inclusive: 2 },
      { zoneId: 'z_waiting', name: 'Зона ожидания', direct: 1, inclusive: 1 },
      { zoneId: 'z_service', name: 'Служебная зона', direct: 0, inclusive: 0 },
    ]);
  });

  test('порядок зон — порядок документа', () => {
    expect(zoneSummary(inventory, naming).map((row) => row.zoneId)).toEqual(
      plan.zones.map((zone) => zone.id),
    );
  });
});

describe('фильтр строк', () => {
  const rows = objectRows(inventory, naming);
  const ids = (query: string, typeId: string | null = null) =>
    filterObjectRows(rows, { query, typeId }).map((row) => row.id);

  test('пустой запрос оставляет все строки', () => {
    expect(ids('')).toEqual(['eq_work_1', 'eq_bench_1']);
    expect(ids('   ')).toEqual(['eq_work_1', 'eq_bench_1']);
  });

  test('ищет по названию объекта без учёта регистра', () => {
    expect(ids('СКАМЬЯ')).toEqual(['eq_bench_1']);
  });

  test('ищет по названию типа, по id типа и по id объекта', () => {
    expect(ids('место ожидания')).toEqual(['eq_bench_1']);
    expect(ids('ot_workplace')).toEqual(['eq_work_1']);
    expect(ids('eq_bench_1')).toEqual(['eq_bench_1']);
  });

  test('ищет по названию и id зоны', () => {
    expect(ids('зона ожидания')).toEqual(['eq_bench_1']);
    expect(ids('z_client')).toEqual(['eq_work_1']);
  });

  test('ищет по инвентарному номеру из атрибутов', () => {
    expect(ids('ОПС-0001'.toLowerCase())).toEqual(['eq_work_1']);
    expect(ids('опс-0001')).toEqual(['eq_work_1']);
  });

  test('числовой атрибут тоже попадает в поиск', () => {
    expect(ids('скамья 3')).toEqual(['eq_bench_1']);
  });

  test('слова соединяются «и», а не «или»', () => {
    expect(ids('скамья рабочее')).toEqual([]);
    expect(ids('скамья ожидания')).toEqual(['eq_bench_1']);
  });

  test('ничего не найдено — пустой список, а не все строки', () => {
    expect(ids('банкомат')).toEqual([]);
  });

  test('выбранный тип сужает список и складывается с запросом', () => {
    expect(ids('', 'ot_bench')).toEqual(['eq_bench_1']);
    expect(ids('скамья', 'ot_workplace')).toEqual([]);
    expect(ids('скамья', 'ot_bench')).toEqual(['eq_bench_1']);
  });
});
