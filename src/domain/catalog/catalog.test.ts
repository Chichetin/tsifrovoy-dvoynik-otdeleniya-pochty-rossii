/**
 * C01 acceptance: the library lives in data, not in code. A new type, a new
 * attribute and a new rule must be addable by editing JSON only — that is the
 * extensibility sub-point of the model criterion.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Catalog, LayerType, ObjectType } from '../../contracts/model';
import { parseCatalog } from '../../contracts/schema';
import {
  CATALOG_ISSUE_CODES,
  defaultAttributes,
  findLayerType,
  findObjectType,
  informationAttributeKeys,
  rulesForObjectType,
  validateCatalog,
} from './index';

function readJson(name: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'catalog', name), 'utf8'),
  ) as unknown;
}

function loadCatalog(): Catalog {
  const parsed = parseCatalog({
    version: '1.0.0',
    objectTypes: readJson('object-types.json'),
    zoneTypes: readJson('zone-types.json'),
    layerTypes: readJson('layer-types.json'),
    rules: readJson('rules.json'),
  });
  if (!parsed.ok) {
    throw new Error(`Справочник не разобрался: ${parsed.issues.map((i) => i.path).join(', ')}`);
  }
  return parsed.value;
}

const catalog = loadCatalog();

/** The eight kinds the task statement requires the library to cover. */
const REQUIRED_KINDS: Record<string, string[]> = {
  'рабочие места': ['ot_workplace'],
  'кассовые окна': ['ot_cashier_window'],
  терминалы: ['ot_payment_terminal', 'ot_queue_terminal', 'ot_pos_terminal'],
  принтеры: ['ot_printer', 'ot_label_printer'],
  стеллажи: ['ot_parcel_rack', 'ot_goods_rack'],
  'места ожидания': ['ot_bench'],
  камеры: ['ot_camera'],
  'инженерное оборудование': ['ot_switchboard', 'ot_hvac', 'ot_water_heater'],
};

describe('справочники из data/catalog', () => {
  test('разбираются схемой и не содержат нарушений', () => {
    expect(validateCatalog(catalog)).toEqual([]);
  });

  test('покрыты все восемь обязательных категорий из условий', () => {
    for (const [kind, ids] of Object.entries(REQUIRED_KINDS)) {
      const present = ids.filter((id) => findObjectType(catalog, id) !== null);
      expect({ kind, present: present.length > 0 }).toEqual({ kind, present: true });
    }
  });

  test('условные размеры подписаны источником', () => {
    for (const type of catalog.objectTypes) {
      expect({ id: type.id, signed: type.provenance.trim().length > 0 }).toEqual({
        id: type.id,
        signed: true,
      });
    }
  });

  test('правило терминала очереди взято из материала организаторов, а не придумано', () => {
    const rules = rulesForObjectType(catalog, 'ot_queue_terminal');
    const distance = rules.find((rule) => rule.kind === 'distance-to-entrance');
    expect(distance?.source).toBe('organizer-material');
    expect(distance?.kind === 'distance-to-entrance' ? distance.maxDistance_m : null).toBe(3);
  });

  test('правила комплектования команды помечены как допущение', () => {
    const team = catalog.rules.filter((rule) => rule.source === 'team-assumption');
    expect(team.length).toBeGreaterThan(0);
    for (const rule of team) {
      expect(rule.rationale).toContain('Правило команды');
    }
  });

  test('оборудование на столе и под потолком не занимает пол', () => {
    expect(findObjectType(catalog, 'ot_printer')?.occupiesFloor).toBe(false);
    expect(findObjectType(catalog, 'ot_camera')?.occupiesFloor).toBe(false);
    expect(findObjectType(catalog, 'ot_camera')?.defaultBase_m).toBeGreaterThan(2);
    expect(findObjectType(catalog, 'ot_workplace')?.occupiesFloor).toBe(true);
  });

  test('значения по умолчанию собираются из атрибутов типа', () => {
    const bench = findObjectType(catalog, 'ot_bench');
    expect(bench).not.toBeNull();
    expect(defaultAttributes(bench as ObjectType)).toEqual({ seats: 3, equipmentStatus: 'unknown' });
  });
});

describe('расширение справочника без правки кода', () => {
  /** Simulates an edit of data/catalog/object-types.json and nothing else. */
  const newType: ObjectType = {
    id: 'ot_parcel_locker',
    label: 'Постамат',
    category: 'Вспомогательные элементы',
    defaultSize_m: [1.8, 0.7],
    defaultHeight_m: 2,
    defaultBase_m: 0,
    physical: true,
    occupiesFloor: true,
    symbol: 'circle',
    color: '#0B7285',
    attributes: [
      { key: 'cells', label: 'Ячеек', type: 'number', required: false, default: 42 },
      { key: 'vendor', label: 'Поставщик', type: 'string', required: false },
    ],
    provenance: 'Синтетическое допущение команды: тип добавлен правкой справочника.',
  };

  test('новый тип с новым атрибутом проходит схему и проверку', () => {
    const extended = parseCatalog({
      ...catalog,
      objectTypes: [...catalog.objectTypes, newType],
      rules: [
        ...catalog.rules,
        {
          id: 'rule_locker_max',
          source: 'team-assumption',
          rationale: 'Правило команды: не больше двух постаматов на клиентскую зону.',
          kind: 'count',
          zoneTypeId: 'zt_client',
          objectTypeId: 'ot_parcel_locker',
          scope: 'inclusive',
          min: null,
          max: 2,
        },
      ],
    });
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    expect(validateCatalog(extended.value)).toEqual([]);
    expect(findObjectType(extended.value, 'ot_parcel_locker')?.label).toBe('Постамат');
    expect(defaultAttributes(newType)).toEqual({ cells: 42 });
    expect(rulesForObjectType(extended.value, 'ot_parcel_locker')).toHaveLength(1);
  });

  test('доступны все условные фигуры, включая generic circle и triangle', () => {
    const symbols = new Set(catalog.objectTypes.map((type) => type.symbol));
    expect(symbols.has('rect')).toBe(true);
    expect(symbols.has('circle')).toBe(true);
    expect(symbols.has('triangle')).toBe(true);
  });
});

describe('информационные слои живут в справочнике', () => {
  test('камеры, тепло и сотрудники — названные заказчиком слои на месте', () => {
    expect(findLayerType(catalog, 'lt_cameras')?.representation.kind).toBe('object-field');
    expect(findLayerType(catalog, 'lt_heat')?.representation.kind).toBe('zone-heat');
    expect(findLayerType(catalog, 'lt_staff')?.representation.kind).toBe('zone-count');
  });

  test('каждый информационный слой подписан: числа синтетические', () => {
    for (const type of catalog.layerTypes) {
      expect({ id: type.id, signed: type.note.trim().length > 0 }).toEqual({
        id: type.id,
        signed: true,
      });
    }
  });

  test('атрибуты, которые читают слои, объявлены в типах зон и камеры', () => {
    const zoneKeys = new Set(
      catalog.zoneTypes.flatMap((type) => type.attributes.map((def) => def.key)),
    );
    const cameraKeys = new Set(
      findObjectType(catalog, 'ot_camera')?.attributes.map((def) => def.key) ?? [],
    );
    for (const type of catalog.layerTypes) {
      const representation = type.representation;
      if (representation.kind === 'zone-heat' || representation.kind === 'zone-count') {
        expect({ id: type.id, declared: zoneKeys.has(representation.attribute) }).toEqual({
          id: type.id,
          declared: true,
        });
      }
      if (representation.kind === 'object-field') {
        expect(cameraKeys.has(representation.angleAttribute)).toBe(true);
        expect(cameraKeys.has(representation.rangeAttribute)).toBe(true);
      }
    }
  });

  test('обычный слой типа не имеет, и findLayerType это говорит', () => {
    expect(findLayerType(catalog, null)).toBeNull();
    expect(findLayerType(catalog, 'lt_missing')).toBeNull();
  });

  test('новый слой добавляется правкой JSON: очередь уже так и сделана', () => {
    // Этот слой — второй `zone-heat` в справочнике: он появился без единой
    // строки кода, только новой записью и атрибутом зоны.
    const queue = findLayerType(catalog, 'lt_queue');
    expect(queue?.representation.kind === 'zone-heat' ? queue.representation.attribute : null)
      .toBe('queueLength');

    const invented: LayerType = {
      id: 'lt_wifi',
      label: 'Покрытие Wi-Fi',
      representation: {
        kind: 'object-field',
        objectTypeIds: ['ot_camera'],
        angleAttribute: 'viewAngleDeg',
        rangeAttribute: 'viewRangeM',
        angle_deg: 360,
        range_m: 12,
        color: '#12B886',
      },
      note: 'Числа синтетические: допущение команды для демонстрации слоя.',
    };
    const extended = parseCatalog({ ...catalog, layerTypes: [...catalog.layerTypes, invented] });
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    expect(validateCatalog(extended.value)).toEqual([]);
    expect(findLayerType(extended.value, 'lt_wifi')?.label).toBe('Покрытие Wi-Fi');
  });
});

describe('проверка справочника ловит ошибки редактирования', () => {
  const codesOf = (catalogUnderTest: Catalog): string[] =>
    validateCatalog(catalogUnderTest).map((entry) => entry.code);

  test('дубликат идентификатора типа', () => {
    const first = catalog.objectTypes[0]!;
    expect(codesOf({ ...catalog, objectTypes: [...catalog.objectTypes, first] })).toContain(
      CATALOG_ISSUE_CODES.DUPLICATE_TYPE_ID,
    );
  });

  test('правило ссылается на несуществующий тип', () => {
    const broken = {
      ...catalog,
      rules: catalog.rules.map((rule) =>
        rule.id === 'rule_workplace_min' ? { ...rule, objectTypeId: 'ot_missing' } : rule,
      ),
    };
    expect(codesOf(broken)).toContain(CATALOG_ISSUE_CODES.UNKNOWN_TYPE_REF);
  });

  test('неподписанный условный размер', () => {
    const unsigned = {
      ...catalog,
      objectTypes: catalog.objectTypes.map((type, index) =>
        index === 0 ? { ...type, provenance: '   ' } : type,
      ),
    };
    expect(codesOf(unsigned)).toContain(CATALOG_ISSUE_CODES.UNSIGNED_ASSUMPTION);
  });

  test('значение по умолчанию не того типа и дубликат ключа атрибута', () => {
    const bad: ObjectType = {
      ...catalog.objectTypes[0]!,
      id: 'ot_bad_attrs',
      attributes: [
        { key: 'count', label: 'Счётчик', type: 'number', required: false, default: 'два' },
        { key: 'count', label: 'Повтор', type: 'number', required: false },
      ],
    };
    const codes = codesOf({ ...catalog, objectTypes: [...catalog.objectTypes, bad] });
    expect(codes).toContain(CATALOG_ISSUE_CODES.DEFAULT_TYPE_MISMATCH);
    expect(codes).toContain(CATALOG_ISSUE_CODES.DUPLICATE_ATTRIBUTE_KEY);
  });

  test('значение по умолчанию вне границ атрибута (#138)', () => {
    const bad: ObjectType = {
      ...catalog.objectTypes[0]!,
      id: 'ot_bad_bounds',
      attributes: [{ key: 'load', label: 'Загрузка', type: 'number', required: false, default: 150, min: 0, max: 100 }],
    };
    expect(codesOf({ ...catalog, objectTypes: [...catalog.objectTypes, bad] })).toContain(
      CATALOG_ISSUE_CODES.DEFAULT_OUT_OF_BOUNDS,
    );
  });

  test('правило без границ и с перевёрнутыми границами', () => {
    const countRule = catalog.rules.find((rule) => rule.kind === 'count')!;
    const empty = { ...catalog, rules: [{ ...countRule, min: null, max: null }] };
    const inverted = { ...catalog, rules: [{ ...countRule, min: 5, max: 2 }] };
    expect(codesOf(empty)).toContain(CATALOG_ISSUE_CODES.EMPTY_RULE_BOUNDS);
    expect(codesOf(inverted)).toContain(CATALOG_ISSUE_CODES.INVERTED_RULE_BOUNDS);
  });

  test('границы правила — целые не меньше нуля, как в схеме файла', () => {
    const countRule = catalog.rules.find((rule) => rule.kind === 'count')!;
    const fractional = { ...catalog, rules: [{ ...countRule, min: 1.5, max: null }] };
    const negative = { ...catalog, rules: [{ ...countRule, min: null, max: -1 }] };
    const whole = { ...catalog, rules: [{ ...countRule, min: 0, max: 2 }] };
    expect(codesOf(fractional)).toContain(CATALOG_ISSUE_CODES.NON_INTEGER_RULE_BOUNDS);
    expect(codesOf(negative)).toContain(CATALOG_ISSUE_CODES.NON_INTEGER_RULE_BOUNDS);
    expect(codesOf(whole)).not.toContain(CATALOG_ISSUE_CODES.NON_INTEGER_RULE_BOUNDS);
  });

  test('тип слоя с неизвестным типом объекта, без типов и с чужим цветом', () => {
    const cameras = findLayerType(catalog, 'lt_cameras')!;
    const field = cameras.representation as Extract<
      LayerType['representation'],
      { kind: 'object-field' }
    >;
    const withField = (patch: Partial<typeof field>): Catalog => ({
      ...catalog,
      layerTypes: [{ ...cameras, representation: { ...field, ...patch } }],
    });

    expect(codesOf(withField({ objectTypeIds: ['ot_missing'] }))).toContain(
      CATALOG_ISSUE_CODES.UNKNOWN_TYPE_REF,
    );
    expect(codesOf(withField({ objectTypeIds: [] }))).toContain(
      CATALOG_ISSUE_CODES.EMPTY_RULE_BOUNDS,
    );
    expect(codesOf(withField({ color: 'фиолетовый' }))).toContain(
      CATALOG_ISSUE_CODES.INVALID_COLOR,
    );
  });

  test('слой с синтетическими числами без подписи — дефект данных', () => {
    const heat = findLayerType(catalog, 'lt_heat')!;
    const scale = heat.representation as Extract<
      LayerType['representation'],
      { kind: 'zone-heat' }
    >;

    expect(codesOf({ ...catalog, layerTypes: [{ ...heat, note: '  ' }] })).toContain(
      CATALOG_ISSUE_CODES.UNSIGNED_ASSUMPTION,
    );
    // Цвета шкалы проверяются оба, а не только первый.
    const badScale: Catalog = {
      ...catalog,
      layerTypes: [
        {
          ...heat,
          representation: { ...scale, colors: ['#D3F9D8', 'красный'] as [string, string] },
        },
      ],
    };
    expect(codesOf(badScale)).toContain(CATALOG_ISSUE_CODES.INVALID_COLOR);
  });

  test('дубликат идентификатора типа слоя', () => {
    const first = catalog.layerTypes[0]!;
    expect(codesOf({ ...catalog, layerTypes: [...catalog.layerTypes, first] })).toContain(
      CATALOG_ISSUE_CODES.DUPLICATE_TYPE_ID,
    );
  });

  test('цвет не в формате #RRGGBB', () => {
    const bad = {
      ...catalog,
      zoneTypes: catalog.zoneTypes.map((type, index) =>
        index === 0 ? { ...type, color: 'синий' } : type,
      ),
    };
    expect(codesOf(bad)).toContain(CATALOG_ISSUE_CODES.INVALID_COLOR);
  });

  test('шкала состояния отвергает повтор, неверный цвет и отсутствующий default', () => {
    const status = catalog.layerTypes.find((type) => type.id === 'lt_equipment_status');
    expect(status?.representation.kind).toBe('object-color');
    if (status?.representation.kind !== 'object-color') return;
    const broken: LayerType = {
      ...status,
      representation: {
        ...status.representation,
        defaultValue: 'missing',
        values: [...status.representation.values, {
          value: status.representation.values[0]!.value,
          label: 'Повтор', color: 'red',
        }],
      },
    };
    const codes = codesOf({ ...catalog, layerTypes: [broken] });
    expect(codes).toContain(CATALOG_ISSUE_CODES.DUPLICATE_LAYER_VALUE);
    expect(codes).toContain(CATALOG_ISSUE_CODES.UNKNOWN_LAYER_DEFAULT);
    expect(codes).toContain(CATALOG_ISSUE_CODES.INVALID_COLOR);
  });
});

describe('informationAttributeKeys', () => {
  const catalog = loadCatalog();

  test('ключи собираются из справочника слоёв, а не из списка в коде', () => {
    const keys = informationAttributeKeys(catalog);
    expect(keys.has('loadPercent')).toBe(true);
    expect(keys.has('staffCount')).toBe(true);
    expect(keys.has('viewAngleDeg')).toBe(true);
    expect(keys.has('viewRangeM')).toBe(true);
    // Обычные атрибуты зоны и объекта пометки не получают.
    expect(keys.has('seatsPlanned')).toBe(false);
  });

  test('новый слой в JSON добавляет свой ключ без правки кода', () => {
    const added: LayerType = {
      id: 'lt_noise',
      label: 'Шум по зонам',
      representation: { kind: 'zone-count', attribute: 'noiseLevel', unit: 'дБ', color: '#7048E8' },
      note: 'Условные значения команды.',
    };
    const keys = informationAttributeKeys({ ...catalog, layerTypes: [...catalog.layerTypes, added] });
    expect(keys.has('noiseLevel')).toBe(true);
  });

  test('обычный слой ключей не добавляет', () => {
    const plain: LayerType = {
      id: 'lt_plain',
      label: 'Обычный',
      representation: { kind: 'objects' },
      note: 'Ничего не рисует поверх.',
    };
    expect(informationAttributeKeys({ ...catalog, layerTypes: [plain] }).size).toBe(0);
  });
});
