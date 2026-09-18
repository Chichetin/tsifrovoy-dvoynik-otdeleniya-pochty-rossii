/**
 * Правки справочника, которые делает специалист по инвентаризации из
 * интерфейса: новый тип оборудования, новый атрибут у типа, новое правило
 * комплектования, удаление. Каждая операция возвращает новый каталог, а
 * применяет его одна команда `catalog.replace` — она же и отвергает
 * недопустимое: удалить тип, которым пользуется объект, нельзя; обязательный
 * атрибут без умолчания нельзя (D-021); сам справочник проверяется
 * `validateCatalog`.
 *
 * Здесь нет ни React, ни знания о документе: чистые функции над `Catalog`,
 * и всё, что они придумывают сами (идентификатор, подпись источника), делают
 * явно и предсказуемо.
 */

import type { AttributeDef, Catalog, CountRule, Id, LayerType, ObjectType, Point } from '../../contracts/model';

/** Новый тип оборудования — все размеры условные, и это записано в источнике. */
export type NewObjectType = {
  label: string;
  category: string;
  size_m: Point;
  height_m: number;
  physical: boolean;
  occupiesFloor: boolean;
  symbol: ObjectType['symbol'];
  color: string;
};

export type NewAttribute = {
  key: string;
  label: string;
  type: AttributeDef['type'];
  required: boolean;
  default?: string | number | boolean;
};

export type NewCountRule = {
  zoneTypeId: Id;
  objectTypeId: Id;
  scope: CountRule['scope'];
  min: number | null;
  max: number | null;
  rationale: string;
};

/** Подпись, которую получает всё, что придумано в интерфейсе, а не взято из материалов. */
export const TEAM_ASSUMPTION_PROVENANCE =
  'Допущение команды: тип добавлен в редакторе, размеры условные, не норматив Почты России.';

/**
 * Идентификатор из подписи: `Сейф ОПС` → `ot_seyf_ops`. Кириллица
 * транслитерируется, остальное — дефис/подчёркивание; занятые — с номером.
 * Идентификатор виден в файле и в ссылках, поэтому он читаемый, а не uuid.
 */
export function slugId(prefix: string, label: string, taken: Iterable<Id>): Id {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const stem = label
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = `${prefix}${stem === '' ? 'new' : stem}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function addObjectType(catalog: Catalog, input: NewObjectType): { catalog: Catalog; id: Id } {
  const id = slugId('ot_', input.label, catalog.objectTypes.map((t) => t.id));
  const type: ObjectType = {
    id,
    label: input.label.trim(),
    category: input.category.trim(),
    defaultSize_m: input.size_m,
    defaultHeight_m: input.height_m,
    defaultBase_m: 0,
    physical: input.physical,
    occupiesFloor: input.occupiesFloor,
    symbol: input.symbol,
    color: input.color,
    attributes: [],
    provenance: TEAM_ASSUMPTION_PROVENANCE,
  };
  return { catalog: { ...catalog, objectTypes: [...catalog.objectTypes, type] }, id };
}

export function removeObjectType(catalog: Catalog, id: Id): Catalog {
  return {
    ...catalog,
    objectTypes: catalog.objectTypes.filter((t) => t.id !== id),
    // A rule about a type that no longer exists would be a broken reference.
    rules: catalog.rules.filter((rule) => rule.objectTypeId !== id),
  };
}

/** Атрибут добавляется к типу объекта или к типу зоны — по идентификатору. */
export function addAttribute(catalog: Catalog, typeId: Id, input: NewAttribute): Catalog {
  const def: AttributeDef = {
    key: input.key.trim(),
    label: input.label.trim(),
    type: input.type,
    required: input.required,
    ...(input.default === undefined ? {} : { default: input.default }),
  };
  const objectTypes = catalog.objectTypes.map((t) =>
    t.id === typeId ? { ...t, attributes: [...t.attributes, def] } : t,
  );
  const zoneTypes = catalog.zoneTypes.map((t) =>
    t.id === typeId ? { ...t, attributes: [...t.attributes, def] } : t,
  );
  return { ...catalog, objectTypes, zoneTypes };
}

export function removeAttribute(catalog: Catalog, typeId: Id, key: string): Catalog {
  const strip = <T extends { id: Id; attributes: AttributeDef[] }>(t: T): T =>
    t.id === typeId ? { ...t, attributes: t.attributes.filter((a) => a.key !== key) } : t;
  return {
    ...catalog,
    objectTypes: catalog.objectTypes.map(strip),
    zoneTypes: catalog.zoneTypes.map(strip),
  };
}

export function addCountRule(catalog: Catalog, input: NewCountRule): { catalog: Catalog; id: Id } {
  const id = slugId('rule_', `${input.objectTypeId}_${input.zoneTypeId}`.replace(/^ot_|_zt_/g, '_'), catalog.rules.map((r) => r.id));
  const rule: CountRule = {
    id,
    kind: 'count',
    source: 'team-assumption',
    rationale: input.rationale.trim(),
    zoneTypeId: input.zoneTypeId,
    objectTypeId: input.objectTypeId,
    scope: input.scope,
    min: input.min,
    max: input.max,
  };
  return { catalog: { ...catalog, rules: [...catalog.rules, rule] }, id };
}

export function removeRule(catalog: Catalog, id: Id): Catalog {
  return { ...catalog, rules: catalog.rules.filter((r) => r.id !== id) };
}

/**
 * Типы слоёв, которые читают этот ключ атрибута: тепловой слой — `loadPercent`,
 * камеры — угол и дальность обзора. Удалить такой атрибут можно — слой лишь
 * перестанет показывать число, — но пользователь должен узнать об этом до
 * клика, а не после того, как карта нагрузки опустела.
 */
export function layersReading(catalog: Catalog, key: string): LayerType[] {
  return catalog.layerTypes.filter((layer) => {
    const r = layer.representation;
    if (r.kind === 'zone-heat' || r.kind === 'zone-count') return r.attribute === key;
    if (r.kind === 'object-field') return r.angleAttribute === key || r.rangeAttribute === key;
    return false;
  });
}
