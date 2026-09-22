/**
 * IO01: the versioned plan file — text in, document out, and back again.
 *
 * Two rules shape this module. First, a file that cannot be read never replaces
 * the document the user already has open: every failure comes back as issues,
 * never as a half-built plan. Second, unreadable structure and fixable geometry
 * are different things — a self-intersecting zone or an object outside the room
 * opens for repair, while a broken reference or a future version does not.
 *
 * Writing is canonical: fields keep the order of the contract and dictionary
 * keys are sorted, so the same content always produces the same bytes. That is
 * what makes the two demo plans in the submission ZIP diffable.
 */

import {
  CONTRACT_ISSUE_CODES,
  LIMITS,
  type AttributeDef,
  type Attributes,
  type Catalog,
  type Equipment,
  type Issue,
  type Layer,
  type LayerType,
  type ObjectType,
  type Opening,
  type PlanDocument,
  type Point,
  type Result,
  type Room,
  type Rule,
  type Wall,
  type Zone,
  type ZoneType,
} from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';

/** Any value JSON can carry. Everything written to a file is narrowed to this. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Indentation of the written file; also what the demo plans in the ZIP use. */
const INDENT = 2;

function issue(code: string, message: string, path?: string): Issue {
  return path === undefined
    ? { code, severity: 'error', message, refs: [] }
    : { code, severity: 'error', message, refs: [], path };
}

/**
 * UTF-8 length, or `null` when the text is over the limit by code units alone.
 * A string never encodes to fewer bytes than it has code units, so an oversized
 * payload is rejected before anything tries to encode it.
 */
function byteLength(text: string): number | null {
  if (text.length > LIMITS.maxRequestBytes) return null;
  return new TextEncoder().encode(text).length;
}

function overSize(bytes: number | null): Issue {
  const measured = bytes === null ? `более ${LIMITS.maxRequestBytes}` : String(bytes);
  return issue(
    CONTRACT_ISSUE_CODES.LIMIT_EXCEEDED,
    `Размер файла ${measured} байт превышает предел ${LIMITS.maxRequestBytes} байт.`,
  );
}

/**
 * Reads a plan file. The caller keeps its current document until this returns
 * ok: there is no partial result.
 */
export function decodePlan(text: string): Result<PlanDocument> {
  const bytes = byteLength(text);
  if (bytes === null || bytes > LIMITS.maxRequestBytes) {
    return { ok: false, issues: [overSize(bytes)] };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [
        issue(
          CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE,
          `Файл не является корректным JSON: ${detail}`,
        ),
      ],
    };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {
      ok: false,
      issues: [
        issue(
          CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE,
          'Файл не содержит объект плана на верхнем уровне.',
        ),
      ],
    };
  }

  // Structure, ids, references and version are decided by the contract owner;
  // geometry deliberately is not, so a broken plan still opens for repair.
  return parsePlanDocument(payload);
}

/**
 * Writes a plan file. The document is validated first: a plan this build would
 * refuse to read must never reach the disk, and a non-finite number must never
 * turn into a silent `null` on the way out.
 */
export function encodePlan(plan: PlanDocument): Result<string> {
  const validated = parsePlanDocument(plan);
  if (!validated.ok) return validated;

  const issues: Issue[] = [];
  const body = canonicalPlan(validated.value, issues);
  if (issues.length > 0) return { ok: false, issues };

  const text = `${JSON.stringify(body, null, INDENT)}\n`;
  const bytes = byteLength(text);
  if (bytes === null || bytes > LIMITS.maxRequestBytes) {
    return { ok: false, issues: [overSize(bytes)] };
  }
  return { ok: true, value: text };
}

/*
 * Canonical writers. Each literal is checked against `Record<keyof T, Json>`,
 * so a field added to a contract type fails to compile here instead of quietly
 * disappearing from saved files.
 */

function point(value: Point): Json {
  return [value[0], value[1]];
}

function polygon(value: Point[]): Json {
  return value.map(point);
}

function attributes(value: Attributes): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out[key] = entry;
  }
  return out;
}

function canonicalAttributeDef(def: AttributeDef): Json {
  const base = {
    key: def.key,
    label: def.label,
    type: def.type,
    required: def.required,
  } satisfies Omit<Record<keyof AttributeDef, Json>, 'default'>;
  return def.default === undefined ? base : { ...base, default: def.default };
}

function canonicalLayer(layer: Layer): Json {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    order: layer.order,
    typeId: layer.typeId,
  } satisfies Record<keyof Layer, Json>;
}

function canonicalZone(zone: Zone): Json {
  return {
    id: zone.id,
    typeId: zone.typeId,
    name: zone.name,
    polygon: polygon(zone.polygon),
    parentId: zone.parentId,
    layerId: zone.layerId,
    attributes: attributes(zone.attributes),
  } satisfies Record<keyof Zone, Json>;
}

function canonicalObject(object: Equipment): Json {
  const base = {
    id: object.id,
    typeId: object.typeId,
    label: object.label,
    position: point(object.position),
    size_m: point(object.size_m),
    rotation_deg: object.rotation_deg,
    base_m: object.base_m,
    height_m: object.height_m,
    zoneId: object.zoneId,
    layerId: object.layerId,
    attributes: attributes(object.attributes),
  } satisfies Omit<Record<keyof Equipment, Json>, 'outline'>;
  // A rectangle has no outline field (D-277): a plain plan keeps its plain file.
  return object.outline === undefined ? base : { ...base, outline: polygon(object.outline) };
}

function canonicalWall(wall: Wall): Json {
  return {
    id: wall.id,
    from: point(wall.from),
    to: point(wall.to),
    thickness_m: wall.thickness_m,
    height_m: wall.height_m,
  } satisfies Record<keyof Wall, Json>;
}

function canonicalOpening(opening: Opening): Json {
  return {
    id: opening.id,
    wallId: opening.wallId,
    offset_m: opening.offset_m,
    width_m: opening.width_m,
    kind: opening.kind,
    sill_m: opening.sill_m,
    height_m: opening.height_m,
  } satisfies Record<keyof Opening, Json>;
}

function canonicalObjectType(type: ObjectType): Json {
  const head = {
    id: type.id,
    label: type.label,
    category: type.category,
    defaultSize_m: point(type.defaultSize_m),
    defaultHeight_m: type.defaultHeight_m,
    defaultBase_m: type.defaultBase_m,
    physical: type.physical,
    occupiesFloor: type.occupiesFloor,
    symbol: type.symbol,
  };
  const tail = {
    color: type.color,
    attributes: type.attributes.map(canonicalAttributeDef),
    provenance: type.provenance,
  };
  // The outline stands after the symbol it overrides; absent for a symbol-only type.
  const all = { ...head, ...tail } satisfies Omit<Record<keyof ObjectType, Json>, 'outline'>;
  return type.outline === undefined ? all : { ...head, outline: polygon(type.outline), ...tail };
}

function canonicalZoneType(type: ZoneType): Json {
  return {
    id: type.id,
    label: type.label,
    color: type.color,
    attributes: type.attributes.map(canonicalAttributeDef),
  } satisfies Record<keyof ZoneType, Json>;
}

function canonicalRule(rule: Rule): Json {
  if (rule.kind === 'count') {
    return {
      id: rule.id,
      kind: rule.kind,
      source: rule.source,
      rationale: rule.rationale,
      zoneTypeId: rule.zoneTypeId,
      objectTypeId: rule.objectTypeId,
      scope: rule.scope,
      min: rule.min,
      max: rule.max,
    } satisfies Record<keyof typeof rule, Json>;
  }
  return {
    id: rule.id,
    kind: rule.kind,
    source: rule.source,
    rationale: rule.rationale,
    objectTypeId: rule.objectTypeId,
    maxDistance_m: rule.maxDistance_m,
    entranceId: rule.entranceId,
  } satisfies Record<keyof typeof rule, Json>;
}

function canonicalLayerRepresentation(representation: LayerType['representation']): Json {
  switch (representation.kind) {
    case 'zone-heat':
      return {
        kind: representation.kind,
        attribute: representation.attribute,
        unit: representation.unit,
        max: representation.max,
        colors: [representation.colors[0], representation.colors[1]],
      } satisfies Record<keyof typeof representation, Json>;
    case 'zone-count':
      return {
        kind: representation.kind,
        attribute: representation.attribute,
        unit: representation.unit,
        color: representation.color,
      } satisfies Record<keyof typeof representation, Json>;
    case 'object-field':
      return {
        kind: representation.kind,
        objectTypeIds: [...representation.objectTypeIds],
        angleAttribute: representation.angleAttribute,
        rangeAttribute: representation.rangeAttribute,
        angle_deg: representation.angle_deg,
        range_m: representation.range_m,
        color: representation.color,
      } satisfies Record<keyof typeof representation, Json>;
    default:
      return { kind: representation.kind } satisfies Record<keyof typeof representation, Json>;
  }
}

function canonicalLayerType(type: LayerType): Json {
  return {
    id: type.id,
    label: type.label,
    representation: canonicalLayerRepresentation(type.representation),
    note: type.note,
  } satisfies Record<keyof LayerType, Json>;
}

function canonicalCatalog(catalog: Catalog): Json {
  return {
    version: catalog.version,
    objectTypes: catalog.objectTypes.map(canonicalObjectType),
    zoneTypes: catalog.zoneTypes.map(canonicalZoneType),
    layerTypes: catalog.layerTypes.map(canonicalLayerType),
    rules: catalog.rules.map(canonicalRule),
  } satisfies Record<keyof Catalog, Json>;
}

function canonicalRoom(room: Room): Json {
  return {
    id: room.id,
    boundary: polygon(room.boundary),
    ceilingHeight_m: room.ceilingHeight_m,
  } satisfies Record<keyof Room, Json>;
}

/**
 * Extensions carry data this build does not model — an importer's leftovers,
 * another tool's annotations. The shape is unknown, so every value is checked
 * before it is written: what JSON.stringify would silently drop or flatten is
 * reported instead.
 */
function canonicalUnknown(value: unknown, path: string, issues: Issue[]): Json {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    issues.push(
      issue(
        CONTRACT_ISSUE_CODES.SCHEMA_INVALID,
        `Значение ${String(value)} нельзя записать в JSON без потери.`,
        path,
      ),
    );
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalUnknown(item, `${path}.${index}`, issues));
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype === Object.prototype || prototype === null) {
      const source = value as Record<string, unknown>;
      const out: Record<string, Json> = {};
      for (const key of Object.keys(source).sort()) {
        out[key] = canonicalUnknown(source[key], `${path}.${key}`, issues);
      }
      return out;
    }
  }

  issues.push(
    issue(
      CONTRACT_ISSUE_CODES.SCHEMA_INVALID,
      `Значение типа ${typeof value} не является данными JSON и не может быть сохранено.`,
      path,
    ),
  );
  return null;
}

function canonicalExtensions(
  extensions: Record<string, unknown>,
  issues: Issue[],
): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const key of Object.keys(extensions).sort()) {
    out[key] = canonicalUnknown(extensions[key], `extensions.${key}`, issues);
  }
  return out;
}

function canonicalPlan(plan: PlanDocument, issues: Issue[]): Json {
  return {
    schemaVersion: plan.schemaVersion,
    id: plan.id,
    name: plan.name,
    room: canonicalRoom(plan.room),
    walls: plan.walls.map(canonicalWall),
    openings: plan.openings.map(canonicalOpening),
    layers: plan.layers.map(canonicalLayer),
    zones: plan.zones.map(canonicalZone),
    objects: plan.objects.map(canonicalObject),
    catalog: canonicalCatalog(plan.catalog),
    extensions: canonicalExtensions(plan.extensions, issues),
  } satisfies Record<keyof PlanDocument, Json>;
}
