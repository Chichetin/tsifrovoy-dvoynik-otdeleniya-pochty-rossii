/**
 * IO01 acceptance: the plan file survives a full round trip, and a file that
 * cannot be read fails loudly instead of returning a damaged document.
 *
 * The round trip is the scenario the jury runs by hand — open, change, save,
 * open again — so everything the editor can hold has to come back byte for
 * byte: custom object types, null attributes, rotation, nesting, extensions.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CONTRACT_ISSUE_CODES,
  LIMITS,
  type Issue,
  type PlanDocument,
} from '../contracts/model';
import { decodePlan, encodePlan } from './codec';

function fixtureText(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8');
}

function codesOf(issues: Issue[]): string[] {
  return issues.map((entry) => entry.code);
}

/** Первый элемент там, где его отсутствие означает сломанную фикстуру, а не проверяемое поведение. */
function first<T>(items: readonly T[], what: string): T {
  const value = items[0];
  if (value === undefined) throw new Error(`нет ни одного элемента: ${what}`);
  return value;
}

/** Decodes a fixture that is expected to be readable. */
function decodeFixture(name: string): PlanDocument {
  const result = decodePlan(fixtureText(name));
  if (!result.ok) {
    throw new Error(`${name} не декодировался: ${codesOf(result.issues).join(', ')}`);
  }
  return result.value;
}

function encodeOrThrow(plan: PlanDocument): string {
  const result = encodePlan(plan);
  if (!result.ok) {
    throw new Error(`план не сохранился: ${codesOf(result.issues).join(', ')}`);
  }
  return result.value;
}

function expectRefused(text: string): Issue[] {
  const result = decodePlan(text);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('ожидался отказ');
  expect(result.issues.length).toBeGreaterThan(0);
  return result.issues;
}

const READABLE = ['minimal.json', 'nested.json', 'rotated.json', 'collision.json', 'outline.json'];

describe('round-trip', () => {
  test.each(READABLE)('%s: encode → decode возвращает тот же документ', (name) => {
    const original = decodeFixture(name);
    const reopened = decodePlan(encodeOrThrow(original));

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toEqual(original);
  });

  test.each(READABLE)('%s: повторное сохранение даёт тот же текст', (name) => {
    const once = encodeOrThrow(decodeFixture(name));

    const reopened = decodePlan(once);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    // Сохранить → открыть → сохранить: файл в ZIP не «дрожит» между прогонами.
    expect(encodeOrThrow(reopened.value)).toBe(once);
  });

  test('контуры (D-277): свой контур объекта и контур типа переживают сохранение и открытие', () => {
    const plan = decodeFixture('outline.json');
    const text = encodeOrThrow(plan);
    const reopened = decodePlan(text);
    if (!reopened.ok) throw new Error('не открылся');
    const byId = (id: string) => reopened.value.objects.find((object) => object.id === id);
    expect(byId('eq_trapezoid')?.outline).toEqual([[-0.5, -0.5], [0.5, -0.5], [0.25, 0.5], [-0.25, 0.5]]);
    expect(byId('eq_corner_desk')?.outline).toEqual(
      reopened.value.catalog.objectTypes.find((type) => type.id === 'ot_corner_desk')?.outline,
    );
    // The circle of a symbol-only type is written into the object: the file
    // says what the checks saw, whatever the catalog of the next reader.
    expect(byId('eq_round_table')?.outline).toHaveLength(24);
    const written = JSON.parse(text) as {
      objects: Record<string, unknown>[];
      catalog: { objectTypes: Record<string, unknown>[] };
    };
    expect(Object.keys(written.catalog.objectTypes.find((type) => type.id === 'ot_corner_desk')!)).toEqual([
      'id', 'label', 'category', 'defaultSize_m', 'defaultHeight_m', 'defaultBase_m', 'physical', 'occupiesFloor',
      'symbol', 'outline', 'color', 'attributes', 'provenance',
    ]);
    // A rectangle keeps a plain file: no field for the default shape.
    expect(written.catalog.objectTypes.find((type) => type.id === 'ot_workplace')).not.toHaveProperty('outline');
    expect(Object.keys(written.objects.find((object) => object.id === 'eq_trapezoid')!).at(-1)).toBe('outline');
    expect(encodeOrThrow(decodeFixture('minimal.json'))).not.toContain('"outline"');
  });

  test('порядок ключей в файле не зависит от порядка ключей в памяти', () => {
    const plan = decodeFixture('minimal.json');
    const withOrder = (order: 'forward' | 'reverse'): PlanDocument => ({
      ...plan,
      objects: plan.objects.map((object) => {
        const entries = Object.entries({
          aaa: 'первый',
          ...object.attributes,
          zzz: 'последний',
        });
        return {
          ...object,
          attributes: Object.fromEntries(order === 'forward' ? entries : entries.reverse()),
        };
      }),
    });

    const straight = withOrder('forward');
    const shuffled = withOrder('reverse');
    expect(Object.keys(first(shuffled.objects, 'объект').attributes)).not.toEqual(
      Object.keys(first(straight.objects, 'объект').attributes),
    );

    expect(encodeOrThrow(shuffled)).toBe(encodeOrThrow(straight));
  });

  test('пользовательский тип оборудования и его атрибуты переживают перенос', () => {
    const plan = decodeFixture('minimal.json');
    const customType = {
      id: 'ot_team_custom',
      label: 'Пункт выдачи посылок',
      category: 'Собственный тип',
      defaultSize_m: [1.1, 0.6] as [number, number],
      defaultHeight_m: 1.9,
      defaultBase_m: 0,
      physical: true,
      occupiesFloor: true,
      symbol: 'rect' as const,
      color: '#12B886',
      attributes: [
        { key: 'cells', label: 'Ячеек', type: 'number' as const, required: true, default: 24 },
        { key: 'note', label: 'Примечание', type: 'string' as const, required: false },
      ],
      provenance: 'Допущение команды: габариты со страницы каталога поставщика.',
    };
    const withCustom: PlanDocument = {
      ...plan,
      catalog: { ...plan.catalog, objectTypes: [...plan.catalog.objectTypes, customType] },
      objects: [
        ...plan.objects,
        {
          id: 'eq_custom_1',
          typeId: customType.id,
          label: 'Выдача 1',
          position: [5, 5],
          size_m: [1.1, 0.6],
          rotation_deg: 90,
          base_m: 0,
          height_m: 1.9,
          zoneId: first(plan.zones, 'зона').id,
          layerId: first(plan.layers, 'слой').id,
          // null — очистка поля пользователем, а не отсутствие значения (D-021).
          attributes: { cells: 24, note: null },
        },
      ],
    };

    const reopened = decodePlan(encodeOrThrow(withCustom));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const object = reopened.value.objects.find((entry) => entry.id === 'eq_custom_1');
    expect(object?.attributes).toEqual({ cells: 24, note: null });
    expect(reopened.value.catalog.objectTypes).toContainEqual(customType);
  });

  test('extensions переносятся целиком, включая вложенные структуры', () => {
    const plan = decodeFixture('minimal.json');
    const extensions = {
      'organizer-import': {
        source: 'example_plan.json',
        droppedFields: ['floor', 'bti_id'],
        nested: { depth: [1, 2, 3], flag: false, empty: null },
      },
      revisionNote: 'перенос без потерь',
    };

    const reopened = decodePlan(encodeOrThrow({ ...plan, extensions }));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.extensions).toEqual(extensions);
  });
});

describe('тип слоя в файле', () => {
  test('план, сохранённый до появления типов слоёв, открывается как обычные слои', () => {
    const raw = JSON.parse(fixtureText('minimal.json')) as {
      layers: Record<string, unknown>[];
      catalog: Record<string, unknown>;
    };
    // Фикстуры F02 написаны до этой правки контракта — они и есть «старый
    // файл», который обязан открыться.
    expect('typeId' in first(raw.layers, 'слой фикстуры')).toBe(false);
    expect('layerTypes' in raw.catalog).toBe(false);

    const plan = decodeFixture('minimal.json');
    expect(plan.layers.map((layer) => layer.typeId)).toEqual(plan.layers.map(() => null));
    expect(plan.catalog.layerTypes).toEqual([]);
  });

  test('информационный слой и его тип переживают сохранение и повторное открытие', () => {
    const plan = decodeFixture('minimal.json');
    const withLayer: PlanDocument = {
      ...plan,
      catalog: {
        ...plan.catalog,
        layerTypes: [
          {
            id: 'lt_heat',
            label: 'Тепловая нагрузка зон',
            representation: {
              kind: 'zone-heat',
              attribute: 'loadPercent',
              unit: '%',
              max: 100,
              colors: ['#D3F9D8', '#FA5252'],
            },
            note: 'Числа синтетические: допущение команды.',
          },
        ],
      },
      layers: [
        ...plan.layers,
        {
          id: 'l_heat',
          name: 'Тепловая нагрузка зон',
          visible: false,
          locked: false,
          order: 1,
          typeId: 'lt_heat',
        },
      ],
    };

    const reopened = decodePlan(encodeOrThrow(withLayer));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toEqual(withLayer);
  });

  test('слой ссылается на несуществующий тип — это отказ загрузки, а не тихий null', () => {
    const raw = JSON.parse(fixtureText('minimal.json')) as {
      layers: Record<string, unknown>[];
    };
    first(raw.layers, 'слой фикстуры').typeId = 'lt_ghost';

    const issues = expectRefused(JSON.stringify(raw));
    expect(codesOf(issues)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);
    expect(issues.map((issue) => issue.path)).toContain('layers.0.typeId');
  });
});

describe('нечитаемый файл не подменяет документ', () => {
  test('обрезанный JSON', () => {
    const truncated = fixtureText('minimal.json').slice(0, 400);
    expect(codesOf(expectRefused(truncated))).toEqual([
      CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE,
    ]);
  });

  test('пустой файл', () => {
    expect(codesOf(expectRefused(''))).toEqual([CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE]);
  });

  test('JSON есть, но это не объект плана', () => {
    for (const text of ['[]', 'null', '42', '"план"']) {
      expect(codesOf(expectRefused(text))).toEqual([
        CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE,
      ]);
    }
  });

  test('будущая версия отклоняется своим кодом, а не как поломка схемы', () => {
    const issues = expectRefused(fixtureText('future-version.json'));
    expect(codesOf(issues)).toEqual([CONTRACT_ISSUE_CODES.FUTURE_VERSION]);
    expect(first(issues, 'ошибка версии').path).toBe('schemaVersion');
  });

  test('чрезмерный размер отклоняется до разбора', () => {
    const oversized = `{"schemaVersion":1,"pad":"${'п'.repeat(LIMITS.maxRequestBytes)}"}`;
    expect(codesOf(expectRefused(oversized))).toEqual([
      CONTRACT_ISSUE_CODES.LIMIT_EXCEEDED,
    ]);
  });

  test('битые ссылки остаются отказом загрузки', () => {
    const codes = new Set(codesOf(expectRefused(fixtureText('invalid-links.json'))));
    expect(codes.has(CONTRACT_ISSUE_CODES.BROKEN_REF)).toBe(true);
  });
});

describe('неверная геометрия открывается для исправления', () => {
  test('пересекающиеся объекты не мешают загрузке', () => {
    const plan = decodeFixture('collision.json');
    expect(plan.objects.length).toBeGreaterThan(1);
  });

  test('самопересекающийся полигон зоны загружается и сохраняется', () => {
    const plan = decodeFixture('minimal.json');
    const bowtie: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone, index) =>
        index === 0
          ? { ...zone, polygon: [[0, 0], [4, 4], [4, 0], [0, 4]] as [number, number][] }
          : zone,
      ),
    };

    const reopened = decodePlan(encodeOrThrow(bowtie));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(first(reopened.value.zones, 'зона').polygon).toEqual([[0, 0], [4, 4], [4, 0], [0, 4]]);
  });
});

describe('сохранение не пишет то, что потом не откроется', () => {
  test('NaN в координате не превращается в null', () => {
    const plan = decodeFixture('minimal.json');
    const broken: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object) => ({
        ...object,
        position: [Number.NaN, object.position[1]],
      })),
    };

    const result = encodePlan(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.issues)).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
  });

  test('дубликат идентификатора отклоняется при сохранении', () => {
    const plan = decodeFixture('minimal.json');
    const duplicated: PlanDocument = {
      ...plan,
      objects: [...plan.objects, { ...first(plan.objects, 'объект') }],
    };

    const result = encodePlan(duplicated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.issues)).toContain(CONTRACT_ISSUE_CODES.DUPLICATE_ID);
  });

  test('не-JSON значение в extensions отклоняется с указанием пути', () => {
    const plan = decodeFixture('minimal.json');
    const result = encodePlan({
      ...plan,
      extensions: { trace: { at: new Date(0) } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const reported = first(result.issues, 'ошибка extensions');
    expect(reported.code).toBe(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    expect(reported.path).toBe('extensions.trace.at');
  });

  test('бесконечность в extensions отклоняется', () => {
    const plan = decodeFixture('minimal.json');
    const result = encodePlan({ ...plan, extensions: { scale: Number.POSITIVE_INFINITY } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(first(result.issues, 'ошибка extensions').path).toBe('extensions.scale');
  });
});

describe('вид файла', () => {
  test('файл читаем человеком и заканчивается переводом строки', () => {
    const text = encodeOrThrow(decodeFixture('minimal.json'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')[0]).toBe('{');
    expect(text).toContain('\n  "schemaVersion": 1,');
  });
});
