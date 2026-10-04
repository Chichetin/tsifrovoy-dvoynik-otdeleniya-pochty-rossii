/**
 * Правки справочника из интерфейса: новый тип, атрибут, правило — и то, что
 * домен отвергает через `catalog.replace`. Главная проверка — сквозная: тип,
 * добавленный этими функциями, проходит `validateCatalog` и `applyCommand`, а
 * удалить тип, которым пользуется объект, нельзя.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { validateCatalog } from '../../domain/catalog';
import { applyCommand } from '../../domain/commands';
import {
  TEAM_ASSUMPTION_PROVENANCE,
  addAttribute,
  addCountRule,
  layersReading,
  addObjectType,
  addZoneType,
  removeAttribute,
  removeObjectType,
  removeZoneType,
  removeRule,
  slugId,
} from './catalog-edit';

function loadPlan(name: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8')));
  if (!parsed.ok) throw new Error(name);
  return parsed.value;
}

const safe = {
  label: 'Сейф ОПС',
  category: 'Безопасность и коммуникации',
  size_m: [0.6, 0.6] as [number, number],
  height_m: 0.8,
  physical: true,
  occupiesFloor: true,
  symbol: 'rect' as const,
  color: '#5F3DC4',
};

describe('идентификаторы', () => {
  test('из подписи получается читаемый латинский id', () => {
    expect(slugId('ot_', 'Сейф ОПС', [])).toBe('ot_seyf_ops');
    expect(slugId('ot_', 'Кофе-машина (2 шт.)', [])).toBe('ot_kofe_mashina_2_sht');
  });

  test('занятый id получает номер, пустая подпись — заглушку', () => {
    expect(slugId('ot_', 'Сейф', ['ot_seyf'])).toBe('ot_seyf_2');
    expect(slugId('ot_', 'Сейф', ['ot_seyf', 'ot_seyf_2'])).toBe('ot_seyf_3');
    expect(slugId('ot_', '!!!', [])).toBe('ot_new');
  });
});

describe('новый тип оборудования', () => {
  test('проходит проверку справочника и подписан как допущение команды', () => {
    const plan = loadPlan('minimal.json');
    const { catalog, id } = addObjectType(plan.catalog, safe);

    expect(id).toBe('ot_seyf_ops');
    const added = catalog.objectTypes.find((t) => t.id === id);
    expect(added?.provenance).toBe(TEAM_ASSUMPTION_PROVENANCE);
    expect(validateCatalog(catalog).filter((i) => i.severity === 'error')).toEqual([]);
  });

  test('применяется командой и после этого объект такого типа ставится', () => {
    const plan = loadPlan('minimal.json');
    const { catalog, id } = addObjectType(plan.catalog, safe);
    const replaced = applyCommand(plan, { type: 'catalog.replace', catalog });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;

    const first = plan.objects[0];
    if (first === undefined) throw new Error('нет объектов');
    const placed = applyCommand(replaced.value, {
      type: 'object.put',
      object: { ...first, id: 'eq_safe_1', typeId: id, size_m: safe.size_m, position: [5, 5] },
    });
    expect(placed.ok).toBe(true);
  });

  test('тип, которым пользуется объект, удалить нельзя — команда отказывает', () => {
    const plan = loadPlan('minimal.json');
    const used = plan.objects[0]?.typeId;
    if (used === undefined) throw new Error('нет объектов');

    const result = applyCommand(plan, { type: 'catalog.replace', catalog: removeObjectType(plan.catalog, used) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe('BROKEN_REF');
    expect(result.issues[0]?.refs[0]?.kind).toBe('object');
  });

  test('удаление типа уносит и правила о нём — иначе битая ссылка', () => {
    const plan = loadPlan('minimal.json');
    const { catalog: withType, id } = addObjectType(plan.catalog, safe);
    const zoneType = withType.zoneTypes[0];
    if (zoneType === undefined) throw new Error('нет типов зон');
    const { catalog: withRule } = addCountRule(withType, {
      zoneTypeId: zoneType.id, objectTypeId: id, scope: 'inclusive', min: 1, max: null, rationale: 'проверка',
    });
    expect(withRule.rules.some((r) => r.objectTypeId === id)).toBe(true);

    const removed = removeObjectType(withRule, id);
    expect(removed.rules.some((r) => r.objectTypeId === id)).toBe(false);
    expect(validateCatalog(removed).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('атрибуты', () => {
  test('новый атрибут появляется у типа и доходит до объекта через команду', () => {
    const plan = loadPlan('minimal.json');
    const typeId = plan.objects[0]?.typeId;
    if (typeId === undefined) throw new Error('нет объектов');

    const catalog = addAttribute(plan.catalog, typeId, {
      key: 'condition', label: 'Состояние', type: 'string', required: false,
    });
    const replaced = applyCommand(plan, { type: 'catalog.replace', catalog });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const def = replaced.value.catalog.objectTypes.find((t) => t.id === typeId)?.attributes.find((a) => a.key === 'condition');
    expect(def?.label).toBe('Состояние');
  });

  test('обязательный атрибут без умолчания отвергается справочником', () => {
    const plan = loadPlan('minimal.json');
    const typeId = plan.objects[0]?.typeId;
    if (typeId === undefined) throw new Error('нет объектов');

    const catalog = addAttribute(plan.catalog, typeId, {
      key: 'serial', label: 'Серийный номер', type: 'string', required: true,
    });
    const result = applyCommand(plan, { type: 'catalog.replace', catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Отказывает команда, а не справочник: у объекта нет значения обязательного атрибута.
    expect(result.issues.map((i) => i.code)).toContain('ATTRIBUTE_REQUIRED');
  });

  test('обязательный атрибут с умолчанием принимается и заполняет объекты', () => {
    const plan = loadPlan('minimal.json');
    const typeId = plan.objects[0]?.typeId;
    if (typeId === undefined) throw new Error('нет объектов');

    const catalog = addAttribute(plan.catalog, typeId, {
      key: 'serial', label: 'Серийный номер', type: 'string', required: true, default: 'б/н',
    });
    const result = applyCommand(plan, { type: 'catalog.replace', catalog });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.objects[0]?.attributes.serial).toBe('б/н');
  });

  test('удаление атрибута снимает его с типа', () => {
    const plan = loadPlan('minimal.json');
    const type = plan.catalog.objectTypes[0];
    const key = type?.attributes[0]?.key;
    if (type === undefined || key === undefined) throw new Error('нет атрибутов в фикстуре');
    const catalog = removeAttribute(plan.catalog, type.id, key);
    expect(catalog.objectTypes[0]?.attributes.some((a) => a.key === key)).toBe(false);
  });
});

describe('правила комплектования', () => {
  test('новое правило — допущение команды, и оно сразу действует', () => {
    const plan = loadPlan('nested.json');
    const zoneType = plan.zones[0]?.typeId;
    const objectType = plan.objects[0]?.typeId;
    if (zoneType === undefined || objectType === undefined) throw new Error('нет данных');

    const { catalog, id } = addCountRule(plan.catalog, {
      zoneTypeId: zoneType, objectTypeId: objectType, scope: 'inclusive', min: 5, max: null,
      rationale: 'В клиентской зоне нужно пять рабочих мест.',
    });
    const rule = catalog.rules.find((r) => r.id === id);
    expect(rule?.source).toBe('team-assumption');

    const replaced = applyCommand(plan, { type: 'catalog.replace', catalog });
    expect(replaced.ok).toBe(true);
  });

  test('min больше max отвергается справочником', () => {
    const plan = loadPlan('nested.json');
    const zoneType = plan.zones[0]?.typeId;
    const objectType = plan.objects[0]?.typeId;
    if (zoneType === undefined || objectType === undefined) throw new Error('нет данных');
    const { catalog } = addCountRule(plan.catalog, {
      zoneTypeId: zoneType, objectTypeId: objectType, scope: 'direct', min: 3, max: 1, rationale: 'x',
    });
    expect(validateCatalog(catalog).map((i) => i.code)).toContain('INVERTED_RULE_BOUNDS');
  });

  test('дробная и отрицательная граница отвергаются до сохранения (схема файла их не примет)', () => {
    const plan = loadPlan('nested.json');
    const zoneType = plan.zones[0]?.typeId;
    const objectType = plan.objects[0]?.typeId;
    if (zoneType === undefined || objectType === undefined) throw new Error('нет данных');
    for (const [min, max] of [[1.5, null], [-1, null], [null, 2.25]] as const) {
      const { catalog } = addCountRule(plan.catalog, {
        zoneTypeId: zoneType, objectTypeId: objectType, scope: 'direct', min, max, rationale: 'x',
      });
      const result = applyCommand(plan, { type: 'catalog.replace', catalog });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((i) => i.code)).toContain('NON_INTEGER_RULE_BOUNDS');
    }
  });

  test('правило удаляется по id', () => {
    const plan = loadPlan('nested.json');
    const zoneType = plan.zones[0]?.typeId;
    const objectType = plan.objects[0]?.typeId;
    if (zoneType === undefined || objectType === undefined) throw new Error('нет данных');
    const { catalog, id } = addCountRule(plan.catalog, {
      zoneTypeId: zoneType, objectTypeId: objectType, scope: 'direct', min: 1, max: null, rationale: 'x',
    });
    expect(removeRule(catalog, id).rules.some((r) => r.id === id)).toBe(false);
  });
});

describe('атрибуты, которые читают слои', () => {
  test('ключ теплового слоя и ключи камер находятся, чужой ключ — нет', () => {
    const catalog = {
      version: 'test',
      objectTypes: [],
      zoneTypes: [],
      rules: [],
      layerTypes: [
        { id: 'lt_heat', label: 'Нагрузка', note: '', representation: { kind: 'zone-heat' as const, attribute: 'loadPercent', unit: '%', max: 100, colors: ['#ffffff', '#ff0000'] as [string, string] } },
        { id: 'lt_cam', label: 'Камеры', note: '', representation: { kind: 'object-field' as const, objectTypeIds: [], angleAttribute: 'viewAngleDeg', rangeAttribute: 'viewRangeM', angle_deg: 90, range_m: 5, color: '#000000' } },
        { id: 'lt_plain', label: 'Обычный', note: '', representation: { kind: 'objects' as const } },
      ],
    };
    expect(layersReading(catalog, 'loadPercent').map((l) => l.id)).toEqual(['lt_heat']);
    expect(layersReading(catalog, 'viewRangeM').map((l) => l.id)).toEqual(['lt_cam']);
    expect(layersReading(catalog, 'condition')).toEqual([]);
  });
});

describe('типы зон', () => {
  test('новый тип зоны проходит команду, получает читаемый id и принимает атрибут', () => {
    const plan = loadPlan('nested.json');
    const { catalog, id } = addZoneType(plan.catalog, { label: 'Комната охраны', color: '#FFE8CC' });
    expect(id).toBe('zt_komnata_ohrany');
    const withAttr = addAttribute(catalog, id, {
      key: 'guardPost', label: 'Пост охраны', type: 'boolean', required: false,
    });
    const result = applyCommand(plan, { type: 'catalog.replace', catalog: withAttr });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const type = result.value.catalog.zoneTypes.find((t) => t.id === id);
      expect(type?.attributes.map((a) => a.key)).toEqual(['guardPost']);
    }
  });

  test('тип зоны, которым пользуется зона, удалить нельзя; свободный — можно, вместе с его правилами', () => {
    const plan = loadPlan('nested.json');
    const used = plan.zones[0]?.typeId;
    if (used === undefined) throw new Error('нет зон');
    const refused = applyCommand(plan, { type: 'catalog.replace', catalog: removeZoneType(plan.catalog, used) });
    expect(refused.ok).toBe(false);

    const { catalog: withType, id } = addZoneType(plan.catalog, { label: 'Склад', color: '#EEEEEE' });
    const objectType = plan.objects[0]?.typeId;
    if (objectType === undefined) throw new Error('нет объектов');
    const { catalog: withRule, id: ruleId } = addCountRule(withType, {
      zoneTypeId: id, objectTypeId: objectType, scope: 'direct', min: 1, max: null, rationale: 'x',
    });
    expect(withRule.rules.some((r) => r.id === ruleId)).toBe(true);
    const removed = removeZoneType(withRule, id);
    expect(removed.zoneTypes.some((t) => t.id === id)).toBe(false);
    expect(removed.rules.some((r) => r.id === ruleId)).toBe(false);
    expect(applyCommand(plan, { type: 'catalog.replace', catalog: removed }).ok).toBe(true);
  });
});
