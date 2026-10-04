/**
 * C01: catalogs of zone types, object types and stocking rules.
 *
 * The data lives in data/catalog/*.json, never in this code: a new object type,
 * a new attribute or a new rule is added by editing JSON. That is a direct
 * sub-point of the model criterion, so anything type-specific that leaks into
 * code here is a defect, not a shortcut.
 */

import type {
  AttributeDef,
  Attributes,
  Catalog,
  Id,
  Issue,
  LayerType,
  ObjectType,
  PlanDocument,
  Ref,
  Rule,
  ZoneType,
} from '../../contracts/model';

/** Codes owned by this module. */
export const CATALOG_ISSUE_CODES = {
  DUPLICATE_TYPE_ID: 'DUPLICATE_TYPE_ID',
  UNKNOWN_TYPE_REF: 'UNKNOWN_TYPE_REF',
  DUPLICATE_ATTRIBUTE_KEY: 'DUPLICATE_ATTRIBUTE_KEY',
  DEFAULT_TYPE_MISMATCH: 'DEFAULT_TYPE_MISMATCH',
  REQUIRED_WITHOUT_DEFAULT: 'REQUIRED_WITHOUT_DEFAULT',
  /** A size or height not taken from the organizers' material must say so. */
  UNSIGNED_ASSUMPTION: 'UNSIGNED_ASSUMPTION',
  INVALID_COLOR: 'INVALID_COLOR',
  /** A number default outside the min/max of its own attribute. */
  DEFAULT_OUT_OF_BOUNDS: 'DEFAULT_OUT_OF_BOUNDS',
  EMPTY_RULE_BOUNDS: 'EMPTY_RULE_BOUNDS',
  INVERTED_RULE_BOUNDS: 'INVERTED_RULE_BOUNDS',
  /** The file schema takes only whole non-negative counts; catch it before save. */
  NON_INTEGER_RULE_BOUNDS: 'NON_INTEGER_RULE_BOUNDS',
  DUPLICATE_LAYER_VALUE: 'DUPLICATE_LAYER_VALUE',
  UNKNOWN_LAYER_DEFAULT: 'UNKNOWN_LAYER_DEFAULT',
} as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function problem(
  code: string,
  message: string,
  path: string,
  severity: Issue['severity'] = 'error',
  refs: Ref[] = [],
): Issue {
  return { code, severity, message, refs, path };
}

function duplicateIds(ids: Id[], namespace: string): Issue[] {
  const seen = new Set<Id>();
  const issues: Issue[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.DUPLICATE_TYPE_ID,
          `Справочник ${namespace}: идентификатор «${id}» повторяется.`,
          namespace,
        ),
      );
    }
    seen.add(id);
  }
  return issues;
}

/** Declared range of a number attribute in words, or null when it has none. */
export function attributeRange(def: AttributeDef): string | null {
  if (def.type !== 'number') return null;
  if (def.min !== undefined && def.max !== undefined) return `от ${def.min} до ${def.max}`;
  if (def.min !== undefined) return `не меньше ${def.min}`;
  if (def.max !== undefined) return `не больше ${def.max}`;
  return null;
}

/**
 * Why a value breaks the bounds of its attribute, or null when it fits. Only
 * numbers are checked; an attribute without min/max accepts any number.
 */
export function attributeBoundsError(def: AttributeDef, value: Attributes[string]): string | null {
  if (def.type !== 'number' || typeof value !== 'number') return null;
  const below = def.min !== undefined && value < def.min;
  const above = def.max !== undefined && value > def.max;
  if (!below && !above) return null;
  return `«${def.label}»: ${value} вне границ, допустимо ${attributeRange(def) ?? ''}.`;
}

/**
 * Attribute values of zones and objects outside the bounds of their type. The
 * plan still opens: these are warnings for the person, not a refusal.
 */
export function attributeBoundsWarnings(plan: PlanDocument): string[] {
  const warnings: string[] = [];
  const check = (id: Id, type: ObjectType | ZoneType | null, attributes: Attributes): void => {
    for (const def of type?.attributes ?? []) {
      const outside = attributeBoundsError(def, attributes[def.key] ?? null);
      if (outside !== null) warnings.push(`${id}: ${outside}`);
    }
  };
  for (const zone of plan.zones) check(zone.id, findZoneType(plan.catalog, zone.typeId), zone.attributes);
  for (const object of plan.objects) check(object.id, findObjectType(plan.catalog, object.typeId), object.attributes);
  return warnings;
}

function attributeIssues(
  owner: ObjectType | ZoneType,
  namespace: string,
): Issue[] {
  const issues: Issue[] = [];
  const keys = new Set<string>();
  owner.attributes.forEach((definition, index) => {
    const path = `${namespace}.${owner.id}.attributes.${index}`;
    if (keys.has(definition.key)) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.DUPLICATE_ATTRIBUTE_KEY,
          `Тип «${owner.id}»: атрибут «${definition.key}» объявлен дважды.`,
          path,
        ),
      );
    }
    keys.add(definition.key);

    if (definition.default !== undefined && typeof definition.default !== definition.type) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.DEFAULT_TYPE_MISMATCH,
          `Тип «${owner.id}»: значение по умолчанию атрибута «${definition.key}» не совпадает с типом ${definition.type}.`,
          path,
        ),
      );
    }

    const outside = attributeBoundsError(definition, definition.default ?? null);
    if (outside !== null) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.DEFAULT_OUT_OF_BOUNDS,
          `Тип «${owner.id}»: значение по умолчанию. ${outside}`,
          path,
        ),
      );
    }

    if (definition.required && definition.default === undefined) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.REQUIRED_WITHOUT_DEFAULT,
          `Тип «${owner.id}»: обязательный атрибут «${definition.key}» без значения по умолчанию — форма создания должна его спросить.`,
          path,
          'warning',
        ),
      );
    }
  });
  return issues;
}

/**
 * Checks an informational layer type: its colours, the object types it paints
 * over, and the note.
 *
 * The note is not decoration. An informational layer shows numbers that nobody
 * measured — load, queue length, staff on shift — and the screen has to say so
 * next to them. A layer type without that sentence is a defect in the data.
 */
function layerTypeIssues(type: LayerType, objectTypeIds: Set<Id>): Issue[] {
  const issues: Issue[] = [];
  const path = `layerTypes.${type.id}`;

  const colour = (value: string, field: string): void => {
    if (HEX_COLOR.test(value)) return;
    issues.push(
      problem(
        CATALOG_ISSUE_CODES.INVALID_COLOR,
        `Тип слоя «${type.id}»: цвет «${value}» не в формате #RRGGBB.`,
        `${path}.${field}`,
      ),
    );
  };

  const representation = type.representation;
  if (representation.kind === 'zone-heat') {
    colour(representation.colors[0], 'representation.colors.0');
    colour(representation.colors[1], 'representation.colors.1');
  }
  if (representation.kind === 'zone-count' || representation.kind === 'object-field') {
    colour(representation.color, 'representation.color');
  }
  if (representation.kind === 'object-color') {
    const values = new Set<string>();
    for (const [index, option] of representation.values.entries()) {
      colour(option.color, `representation.values.${index}.color`);
      if (values.has(option.value)) {
        issues.push(problem(
          CATALOG_ISSUE_CODES.DUPLICATE_LAYER_VALUE,
          `Тип слоя «${type.id}»: значение «${option.value}» объявлено дважды.`,
          `${path}.representation.values.${index}.value`,
        ));
      }
      values.add(option.value);
    }
    if (!values.has(representation.defaultValue)) {
      issues.push(problem(
        CATALOG_ISSUE_CODES.UNKNOWN_LAYER_DEFAULT,
        `Тип слоя «${type.id}»: значение по умолчанию отсутствует в шкале.`,
        `${path}.representation.defaultValue`,
      ));
    }
  }
  if (representation.kind === 'object-field') {
    if (representation.objectTypeIds.length === 0) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.EMPTY_RULE_BOUNDS,
          `Тип слоя «${type.id}»: не указан ни один тип объекта — рисовать нечего.`,
          `${path}.representation.objectTypeIds`,
        ),
      );
    }
    for (const objectTypeId of representation.objectTypeIds) {
      if (objectTypeIds.has(objectTypeId)) continue;
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.UNKNOWN_TYPE_REF,
          `Тип слоя «${type.id}»: тип объекта «${objectTypeId}» отсутствует в справочнике.`,
          `${path}.representation.objectTypeIds`,
        ),
      );
    }
  }

  if (representation.kind !== 'objects' && type.note.trim().length === 0) {
    issues.push(
      problem(
        CATALOG_ISSUE_CODES.UNSIGNED_ASSUMPTION,
        `Тип слоя «${type.id}»: не подписано, откуда берутся числа.`,
        `${path}.note`,
      ),
    );
  }

  return issues;
}

/**
 * Structural and honesty checks over a catalog. The schema already guarantees
 * shapes; this adds what a schema cannot: references, attribute sanity and that
 * invented dimensions carry their source.
 */
export function validateCatalog(catalog: Catalog): Issue[] {
  const issues: Issue[] = [
    ...duplicateIds(catalog.objectTypes.map((type) => type.id), 'objectTypes'),
    ...duplicateIds(catalog.zoneTypes.map((type) => type.id), 'zoneTypes'),
    ...duplicateIds(catalog.layerTypes.map((type) => type.id), 'layerTypes'),
    ...duplicateIds(catalog.rules.map((rule) => rule.id), 'rules'),
  ];

  const objectTypeIds = new Set(catalog.objectTypes.map((type) => type.id));
  const zoneTypeIds = new Set(catalog.zoneTypes.map((type) => type.id));

  for (const type of catalog.objectTypes) {
    issues.push(...attributeIssues(type, 'objectTypes'));
    if (!HEX_COLOR.test(type.color)) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.INVALID_COLOR,
          `Тип «${type.id}»: цвет «${type.color}» не в формате #RRGGBB.`,
          `objectTypes.${type.id}.color`,
        ),
      );
    }
    if (type.provenance.trim().length === 0) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.UNSIGNED_ASSUMPTION,
          `Тип «${type.id}»: не указан источник размеров.`,
          `objectTypes.${type.id}.provenance`,
        ),
      );
    }
  }

  for (const type of catalog.zoneTypes) {
    issues.push(...attributeIssues(type, 'zoneTypes'));
    if (!HEX_COLOR.test(type.color)) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.INVALID_COLOR,
          `Тип зоны «${type.id}»: цвет «${type.color}» не в формате #RRGGBB.`,
          `zoneTypes.${type.id}.color`,
        ),
      );
    }
  }

  for (const type of catalog.layerTypes) {
    issues.push(...layerTypeIssues(type, objectTypeIds));
  }

  catalog.rules.forEach((rule, index) => {
    const path = `rules.${index}`;
    if (!objectTypeIds.has(rule.objectTypeId)) {
      issues.push(
        problem(
          CATALOG_ISSUE_CODES.UNKNOWN_TYPE_REF,
          `Правило «${rule.id}»: тип объекта «${rule.objectTypeId}» отсутствует в справочнике.`,
          path,
        ),
      );
    }
    if (rule.kind === 'count') {
      if (!zoneTypeIds.has(rule.zoneTypeId)) {
        issues.push(
          problem(
            CATALOG_ISSUE_CODES.UNKNOWN_TYPE_REF,
            `Правило «${rule.id}»: тип зоны «${rule.zoneTypeId}» отсутствует в справочнике.`,
            path,
          ),
        );
      }
      if (rule.min === null && rule.max === null) {
        issues.push(
          problem(
            CATALOG_ISSUE_CODES.EMPTY_RULE_BOUNDS,
            `Правило «${rule.id}»: не задано ни min, ни max — проверять нечего.`,
            path,
          ),
        );
      }
      const bounds = [rule.min, rule.max].filter((b): b is number => b !== null);
      if (bounds.some((b) => !Number.isInteger(b) || b < 0)) {
        issues.push(
          problem(
            CATALOG_ISSUE_CODES.NON_INTEGER_RULE_BOUNDS,
            `Правило «${rule.id}»: границы должны быть целыми числами не меньше нуля.`,
            path,
          ),
        );
      }
      if (rule.min !== null && rule.max !== null && rule.min > rule.max) {
        issues.push(
          problem(
            CATALOG_ISSUE_CODES.INVERTED_RULE_BOUNDS,
            `Правило «${rule.id}»: min ${rule.min} больше max ${rule.max}.`,
            path,
          ),
        );
      }
    }
  });

  return issues;
}

export function findObjectType(catalog: Catalog, typeId: Id): ObjectType | null {
  return catalog.objectTypes.find((type) => type.id === typeId) ?? null;
}

export function findZoneType(catalog: Catalog, typeId: Id): ZoneType | null {
  return catalog.zoneTypes.find((type) => type.id === typeId) ?? null;
}

/** `null` for an ordinary layer, and for a type the file no longer carries. */
export function findLayerType(catalog: Catalog, typeId: Id | null): LayerType | null {
  if (typeId === null) return null;
  return catalog.layerTypes.find((type) => type.id === typeId) ?? null;
}

/** Attribute values a new instance of the type starts with. */
export function defaultAttributes(type: ObjectType | ZoneType): Attributes {
  const values: Attributes = {};
  for (const definition of type.attributes) {
    if (definition.default !== undefined) values[definition.key] = definition.default;
  }
  return values;
}

/** Rules that apply to a given object type. */
export function rulesForObjectType(catalog: Catalog, typeId: Id): Rule[] {
  return catalog.rules.filter((rule) => rule.objectTypeId === typeId);
}

/**
 * Attribute keys an information layer paints. A person types these values in
 * for planning, so every field feeding a layer is marked as conditional
 * wherever it is shown (D-276). The list comes from the catalog: a new layer in
 * JSON brings its own keys along and needs no change here.
 */
export function informationAttributeKeys(catalog: Catalog): Set<string> {
  const keys = new Set<string>();
  for (const type of catalog.layerTypes) {
    const representation = type.representation;
    if (representation.kind === 'zone-heat' || representation.kind === 'zone-count') {
      keys.add(representation.attribute);
    }
    if (representation.kind === 'object-field') {
      keys.add(representation.angleAttribute);
      keys.add(representation.rangeAttribute);
    }
    if (representation.kind === 'object-color') keys.add(representation.attribute);
  }
  return keys;
}
