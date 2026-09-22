/**
 * Contracts v1: input schema, limits and structural checks. Frozen by F02, see
 * docs/contracts-v1.md.
 *
 * This module rejects a document that cannot be worked with — broken structure,
 * duplicate ids, broken references, a zone cycle, a future schema version or an
 * input over the v1 limits. It deliberately does NOT reject invalid geometry:
 * a self-intersecting polygon or an object outside the room opens with a
 * diagnostic so the user can fix it in the editor.
 */

import { z } from 'zod';
import {
  CONTRACT_ISSUE_CODES,
  type Catalog,
  LIMITS,
  SCHEMA_VERSION,
  type Issue,
  type PlanDocument,
  type Ref,
  type Result,
} from './model';
import { normalizeOutline, outlineFits, withTypeOutline } from './outline';

const finiteNumber = z.number().finite();
const positiveNumber = finiteNumber.positive();
const nonNegativeNumber = finiteNumber.min(0);
const idSchema = z.string().min(1);
const pointSchema = z.tuple([finiteNumber, finiteNumber]);
const sizeSchema = z.tuple([positiveNumber, positiveNumber]);
const polygonSchema = z.array(pointSchema).min(3).max(LIMITS.maxPolygonVertices);

/**
 * Object outline (D-277): fractions of `size_m`, box spanning [-0.5, 0.5].
 * A box that misses by rounding is rescaled; a box that misses by more means
 * `size_m` would lie about the extent, and the file is refused. Self-crossing
 * is geometry, not structure: it opens and is reported by validation (D-013).
 */
const outlineSchema = polygonSchema
  .refine(outlineFits, {
    message: 'Контур объекта задаётся в долях габарита: его рамка должна занимать ровно от −0,5 до 0,5 по обеим осям.',
  })
  .transform(normalizeOutline);

const attributesSchema = z.record(
  z.string(),
  z.union([z.string(), finiteNumber, z.boolean(), z.null()]),
);

export const refSchema = z.object({
  kind: z.enum(['room', 'zone', 'object', 'layer', 'wall', 'opening']),
  id: idSchema,
});

const layerSchema = z.object({
  id: idSchema,
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
  order: finiteNumber,
  // Files written before layer types existed have no field here, and they must
  // keep opening: no type means an ordinary layer of objects.
  typeId: idSchema.nullable().default(null),
});

const zoneSchema = z.object({
  id: idSchema,
  typeId: idSchema,
  name: z.string(),
  polygon: polygonSchema,
  parentId: idSchema.nullable(),
  layerId: idSchema,
  attributes: attributesSchema,
});

const equipmentSchema = z.object({
  id: idSchema,
  typeId: idSchema,
  label: z.string(),
  position: pointSchema,
  size_m: sizeSchema,
  rotation_deg: finiteNumber.min(0).lt(360),
  base_m: nonNegativeNumber,
  height_m: positiveNumber,
  zoneId: idSchema.nullable(),
  layerId: idSchema,
  attributes: attributesSchema,
  outline: outlineSchema.optional(),
});

const wallSchema = z.object({
  id: idSchema,
  from: pointSchema,
  to: pointSchema,
  thickness_m: positiveNumber,
  height_m: positiveNumber,
});

const openingSchema = z.object({
  id: idSchema,
  wallId: idSchema,
  offset_m: nonNegativeNumber,
  width_m: positiveNumber,
  kind: z.enum(['entrance', 'door', 'window']),
  sill_m: nonNegativeNumber,
  height_m: positiveNumber,
});

const attributeDefSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean(),
  default: z.union([z.string(), finiteNumber, z.boolean()]).optional(),
});

const objectTypeSchema = z.object({
  id: idSchema,
  label: z.string(),
  category: z.string(),
  defaultSize_m: sizeSchema,
  defaultHeight_m: positiveNumber,
  defaultBase_m: nonNegativeNumber,
  physical: z.boolean(),
  occupiesFloor: z.boolean(),
  symbol: z.enum(['rect', 'circle', 'triangle']),
  outline: outlineSchema.optional(),
  color: z.string(),
  attributes: z.array(attributeDefSchema),
  provenance: z.string(),
});

const zoneTypeSchema = z.object({
  id: idSchema,
  label: z.string(),
  color: z.string(),
  attributes: z.array(attributeDefSchema),
});

const ruleBase = {
  id: idSchema,
  source: z.enum(['team-assumption', 'organizer-material']),
  rationale: z.string(),
};

const ruleSchema = z.discriminatedUnion('kind', [
  z.object({
    ...ruleBase,
    kind: z.literal('count'),
    zoneTypeId: idSchema,
    objectTypeId: idSchema,
    scope: z.enum(['direct', 'inclusive']),
    min: finiteNumber.int().min(0).nullable(),
    max: finiteNumber.int().min(0).nullable(),
  }),
  z.object({
    ...ruleBase,
    kind: z.literal('distance-to-entrance'),
    objectTypeId: idSchema,
    maxDistance_m: positiveNumber,
    entranceId: idSchema.nullable(),
  }),
]);

const layerRepresentationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('objects') }),
  z.object({
    kind: z.literal('zone-heat'),
    attribute: z.string().min(1),
    unit: z.string(),
    max: positiveNumber,
    colors: z.tuple([z.string(), z.string()]),
  }),
  z.object({
    kind: z.literal('zone-count'),
    attribute: z.string().min(1),
    unit: z.string(),
    color: z.string(),
  }),
  z.object({
    kind: z.literal('object-field'),
    objectTypeIds: z.array(idSchema),
    angleAttribute: z.string().min(1),
    rangeAttribute: z.string().min(1),
    angle_deg: positiveNumber.max(360),
    range_m: positiveNumber,
    color: z.string(),
  }),
]);

const layerTypeSchema = z.object({
  id: idSchema,
  label: z.string(),
  representation: layerRepresentationSchema,
  note: z.string(),
});

export const catalogSchema = z.object({
  version: z.string(),
  objectTypes: z.array(objectTypeSchema),
  zoneTypes: z.array(zoneTypeSchema),
  // Same reason as Layer.typeId: a catalog written before layer types is valid
  // and simply offers none.
  layerTypes: z.array(layerTypeSchema).default([]),
  rules: z.array(ruleSchema),
});

const roomSchema = z.object({
  id: idSchema,
  boundary: polygonSchema,
  ceilingHeight_m: positiveNumber,
});

export const planDocumentSchema: z.ZodType<PlanDocument> = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: idSchema,
  name: z.string(),
  room: roomSchema,
  walls: z.array(wallSchema),
  openings: z.array(openingSchema),
  layers: z.array(layerSchema).min(1),
  zones: z.array(zoneSchema).max(LIMITS.maxZones),
  objects: z.array(equipmentSchema).max(LIMITS.maxObjects),
  catalog: catalogSchema,
  extensions: z.record(z.string(), z.unknown()),
});

/** Parses a standalone catalog, for the JSON files under data/catalog. */
export function parseCatalog(input: unknown): Result<Catalog> {
  const parsed = catalogSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((entry) =>
      issue(CONTRACT_ISSUE_CODES.SCHEMA_INVALID, entry.message, [], entry.path.join('.')),
    ),
  };
}

function issue(code: string, message: string, refs: Ref[] = [], path?: string): Issue {
  return path === undefined
    ? { code, severity: 'error', message, refs }
    : { code, severity: 'error', message, refs, path };
}

/** Reads schemaVersion without trusting the rest of the payload. */
function readSchemaVersion(input: unknown): number | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as { schemaVersion?: unknown }).schemaVersion;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectDuplicateIds(plan: PlanDocument): Issue[] {
  const seen = new Map<string, Ref>();
  const issues: Issue[] = [];
  const add = (ref: Ref): void => {
    const previous = seen.get(ref.id);
    if (previous !== undefined) {
      issues.push(
        issue(
          CONTRACT_ISSUE_CODES.DUPLICATE_ID,
          `Идентификатор «${ref.id}» встречается больше одного раза.`,
          [previous, ref],
        ),
      );
      return;
    }
    seen.set(ref.id, ref);
  };

  add({ kind: 'room', id: plan.room.id });
  for (const layer of plan.layers) add({ kind: 'layer', id: layer.id });
  for (const wall of plan.walls) add({ kind: 'wall', id: wall.id });
  for (const opening of plan.openings) add({ kind: 'opening', id: opening.id });
  for (const zone of plan.zones) add({ kind: 'zone', id: zone.id });
  for (const object of plan.objects) add({ kind: 'object', id: object.id });
  return issues;
}

/** Type and rule ids live in their own namespaces, checked separately. */
function collectCatalogDuplicates(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  const check = (ids: string[], namespace: string): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        issues.push(
          issue(
            CONTRACT_ISSUE_CODES.DUPLICATE_ID,
            `Справочник ${namespace}: идентификатор «${id}» повторяется.`,
            [],
            `catalog.${namespace}`,
          ),
        );
      }
      seen.add(id);
    }
  };
  check(plan.catalog.objectTypes.map((type) => type.id), 'objectTypes');
  check(plan.catalog.zoneTypes.map((type) => type.id), 'zoneTypes');
  check(plan.catalog.layerTypes.map((type) => type.id), 'layerTypes');
  check(plan.catalog.rules.map((rule) => rule.id), 'rules');
  return issues;
}

function collectBrokenRefs(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  const layerIds = new Set(plan.layers.map((layer) => layer.id));
  const zoneIds = new Set(plan.zones.map((zone) => zone.id));
  const wallIds = new Set(plan.walls.map((wall) => wall.id));
  const openingIds = new Set(plan.openings.map((opening) => opening.id));
  const objectTypeIds = new Set(plan.catalog.objectTypes.map((type) => type.id));
  const zoneTypeIds = new Set(plan.catalog.zoneTypes.map((type) => type.id));
  const layerTypeIds = new Set(plan.catalog.layerTypes.map((type) => type.id));

  const broken = (message: string, refs: Ref[], path: string): void => {
    issues.push(issue(CONTRACT_ISSUE_CODES.BROKEN_REF, message, refs, path));
  };

  plan.layers.forEach((layer, index) => {
    if (layer.typeId !== null && !layerTypeIds.has(layer.typeId)) {
      broken(
        `Слой «${layer.id}»: тип «${layer.typeId}» не найден в справочнике.`,
        [{ kind: 'layer', id: layer.id }],
        `layers.${index}.typeId`,
      );
    }
  });

  plan.zones.forEach((zone, index) => {
    const ref: Ref = { kind: 'zone', id: zone.id };
    if (!layerIds.has(zone.layerId)) {
      broken(`Зона «${zone.id}»: слой «${zone.layerId}» не существует.`, [ref], `zones.${index}.layerId`);
    }
    if (zone.parentId !== null && !zoneIds.has(zone.parentId)) {
      broken(`Зона «${zone.id}»: родительская зона «${zone.parentId}» не существует.`, [ref], `zones.${index}.parentId`);
    }
    if (!zoneTypeIds.has(zone.typeId)) {
      broken(`Зона «${zone.id}»: тип «${zone.typeId}» не найден в справочнике.`, [ref], `zones.${index}.typeId`);
    }
  });

  plan.objects.forEach((object, index) => {
    const ref: Ref = { kind: 'object', id: object.id };
    if (!layerIds.has(object.layerId)) {
      broken(`Объект «${object.id}»: слой «${object.layerId}» не существует.`, [ref], `objects.${index}.layerId`);
    }
    if (object.zoneId !== null && !zoneIds.has(object.zoneId)) {
      broken(`Объект «${object.id}»: зона «${object.zoneId}» не существует.`, [ref], `objects.${index}.zoneId`);
    }
    if (!objectTypeIds.has(object.typeId)) {
      broken(`Объект «${object.id}»: тип «${object.typeId}» не найден в справочнике.`, [ref], `objects.${index}.typeId`);
    }
  });

  plan.openings.forEach((opening, index) => {
    if (!wallIds.has(opening.wallId)) {
      broken(
        `Проём «${opening.id}»: стена «${opening.wallId}» не существует.`,
        [{ kind: 'opening', id: opening.id }],
        `openings.${index}.wallId`,
      );
    }
  });

  plan.catalog.rules.forEach((rule, index) => {
    if (!objectTypeIds.has(rule.objectTypeId)) {
      broken(`Правило «${rule.id}»: тип объекта «${rule.objectTypeId}» не найден.`, [], `catalog.rules.${index}.objectTypeId`);
    }
    if (rule.kind === 'count' && !zoneTypeIds.has(rule.zoneTypeId)) {
      broken(`Правило «${rule.id}»: тип зоны «${rule.zoneTypeId}» не найден.`, [], `catalog.rules.${index}.zoneTypeId`);
    }
    if (rule.kind === 'distance-to-entrance' && rule.entranceId !== null && !openingIds.has(rule.entranceId)) {
      broken(`Правило «${rule.id}»: вход «${rule.entranceId}» не существует.`, [], `catalog.rules.${index}.entranceId`);
    }
  });

  return issues;
}

function collectZoneCycles(plan: PlanDocument): Issue[] {
  const parents = new Map<string, string | null>();
  for (const zone of plan.zones) parents.set(zone.id, zone.parentId);

  const issues: Issue[] = [];
  const settled = new Set<string>();

  for (const zone of plan.zones) {
    if (settled.has(zone.id)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | null = zone.id;

    while (current !== null && parents.has(current) && !settled.has(current)) {
      if (onPath.has(current)) {
        const cycle = path.slice(path.indexOf(current));
        issues.push(
          issue(
            CONTRACT_ISSUE_CODES.ZONE_CYCLE,
            `Вложенность зон замыкается в цикл: ${cycle.join(' → ')} → ${current}.`,
            cycle.map((id) => ({ kind: 'zone', id }) satisfies Ref),
          ),
        );
        break;
      }
      path.push(current);
      onPath.add(current);
      current = parents.get(current) ?? null;
    }
    for (const id of path) settled.add(id);
  }

  return issues;
}

function collectLimitIssues(plan: PlanDocument): Issue[] {
  const totalVertices =
    plan.room.boundary.length +
    plan.zones.reduce((sum, zone) => sum + zone.polygon.length, 0);
  if (totalVertices <= LIMITS.maxTotalVertices) return [];
  return [
    issue(
      CONTRACT_ISSUE_CODES.LIMIT_EXCEEDED,
      `Суммарное число вершин ${totalVertices} превышает предел ${LIMITS.maxTotalVertices}.`,
    ),
  ];
}

/**
 * Every object leaves the parser with its shape (D-277): an object without its
 * own outline takes its type's, so geometry never has to consult the catalog
 * and a file written before outlines shows circles and triangles as they are.
 */
function withObjectOutlines(plan: PlanDocument): PlanDocument {
  if (plan.objects.every((object) => object.outline !== undefined)) return plan;
  const types = new Map(plan.catalog.objectTypes.map((type) => [type.id, type]));
  return {
    ...plan,
    objects: plan.objects.map((object) =>
      object.outline === undefined ? withTypeOutline(object, types.get(object.typeId)) : object,
    ),
  };
}

/**
 * Validates structure and references. Geometry correctness is not decided here:
 * a structurally sound but geometrically broken plan must open for repair.
 */
export function parsePlanDocument(input: unknown): Result<PlanDocument> {
  const version = readSchemaVersion(input);
  if (version !== null && version > SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        issue(
          CONTRACT_ISSUE_CODES.FUTURE_VERSION,
          `Версия формата ${version} новее поддерживаемой ${SCHEMA_VERSION}.`,
          [],
          'schemaVersion',
        ),
      ],
    };
  }

  const parsed = planDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((entry) => {
        const path = entry.path.join('.');
        const code =
          path === 'layers' && entry.code === 'too_small'
            ? CONTRACT_ISSUE_CODES.NO_LAYERS
            : CONTRACT_ISSUE_CODES.SCHEMA_INVALID;
        return issue(code, entry.message, [], path);
      }),
    };
  }

  const plan = withObjectOutlines(parsed.data);
  const issues = [
    ...collectDuplicateIds(plan),
    ...collectCatalogDuplicates(plan),
    ...collectBrokenRefs(plan),
    ...collectZoneCycles(plan),
    ...collectLimitIssues(plan),
  ];

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: plan };
}
