/**
 * S01: atomic edits of a plan document. One command is one undo step.
 *
 * Structural mistakes (unknown ids, id collisions, a locked layer, an
 * attribute that does not fit its type) are refused and the caller keeps the
 * previous document. Geometry mistakes are accepted on purpose: a
 * self-intersecting zone stays in the document as a diagnosable state so the
 * next gesture can fix it, which is what contracts-v1.md requires of S01.
 */

import type {
  AttributeDef,
  Attributes,
  Catalog,
  Id,
  Issue,
  Layer,
  PlanDocument,
  Ref,
  RefKind,
  Result,
  Zone,
} from '../../contracts/model';
import type { Command } from '../../contracts/commands';
import { CONTRACT_ISSUE_CODES } from '../../contracts/model';
import { validateCatalog } from '../catalog';
import { hasZoneCycle, reconcileZones } from '../relations';

/** Codes owned by this module, next to its own checks. */
export const COMMAND_ISSUE_CODES = {
  /** The layer holding the target rejects edits of its content. */
  LAYER_LOCKED: 'LAYER_LOCKED',
  /** layer.delete needs a different, existing, unlocked layer to move content to. */
  MOVE_TARGET_INVALID: 'MOVE_TARGET_INVALID',
  /** A required attribute has no value and its type declares no default. */
  ATTRIBUTE_REQUIRED: 'ATTRIBUTE_REQUIRED',
  /** An attribute value does not match the type declared by the catalog. */
  ATTRIBUTE_TYPE: 'ATTRIBUTE_TYPE',
  /** A deleted id is never reused. */
  ID_REUSED: 'ID_REUSED',
} as const;

export type CommandIssueCode =
  (typeof COMMAND_ISSUE_CODES)[keyof typeof COMMAND_ISSUE_CODES];

function fail(code: string, message: string, refs: Ref[]): Result<never> {
  return { ok: false, issues: [{ code, severity: 'error', message, refs }] };
}

function failWith(issues: Issue[]): Result<never> {
  return { ok: false, issues };
}

/** Every id the document uses, mapped to the kind that owns it. */
export function idOwners(plan: PlanDocument): Map<Id, RefKind> {
  const owners = new Map<Id, RefKind>();
  owners.set(plan.room.id, 'room');
  for (const layer of plan.layers) owners.set(layer.id, 'layer');
  for (const wall of plan.walls) owners.set(wall.id, 'wall');
  for (const opening of plan.openings) owners.set(opening.id, 'opening');
  for (const zone of plan.zones) owners.set(zone.id, 'zone');
  for (const object of plan.objects) owners.set(object.id, 'object');
  return owners;
}

/** A put may replace its own entity, but never take an id of another kind. */
function checkIdFree(plan: PlanDocument, id: Id, kind: RefKind): Result<null> {
  const owner = idOwners(plan).get(id);
  if (owner !== undefined && owner !== kind) {
    return fail(
      CONTRACT_ISSUE_CODES.DUPLICATE_ID,
      `Идентификатор «${id}» уже занят другой сущностью плана (${owner}).`,
      [{ kind, id }],
    );
  }
  return { ok: true, value: null };
}

function layerOf(plan: PlanDocument, layerId: Id): Layer | undefined {
  return plan.layers.find((layer) => layer.id === layerId);
}

/** Editing content of a locked layer is refused; the layer entity itself is not. */
function checkLayerEditable(plan: PlanDocument, layerId: Id, ref: Ref): Result<Layer> {
  const layer = layerOf(plan, layerId);
  if (layer === undefined) {
    return fail(
      CONTRACT_ISSUE_CODES.BROKEN_REF,
      `Слой «${layerId}» не существует.`,
      [ref, { kind: 'layer', id: layerId }],
    );
  }
  if (layer.locked) {
    return fail(
      COMMAND_ISSUE_CODES.LAYER_LOCKED,
      `Слой «${layer.name}» заперт: его содержимое не изменяется.`,
      [ref, { kind: 'layer', id: layerId }],
    );
  }
  return { ok: true, value: layer };
}

function attributeMissing(value: Attributes[string] | undefined): boolean {
  return value === undefined || value === null;
}

/**
 * Checks attribute values against the definitions of the entity's type.
 * Unknown keys are kept: the type dictionary is extensible and validatePlan
 * warns about them, so a custom field is never dropped silently.
 */
function normaliseAttributes(
  defs: AttributeDef[],
  attributes: Attributes,
  ref: Ref,
): Result<Attributes> {
  const value: Attributes = { ...attributes };
  const issues: Issue[] = [];

  for (const def of defs) {
    const current = value[def.key];

    if (attributeMissing(current)) {
      if (def.default !== undefined) {
        value[def.key] = def.default;
      } else if (def.required) {
        issues.push({
          code: COMMAND_ISSUE_CODES.ATTRIBUTE_REQUIRED,
          severity: 'error',
          message: `Атрибут «${def.label}» обязателен, а значения и значения по умолчанию нет.`,
          refs: [ref],
          path: `/attributes/${def.key}`,
        });
      }
      continue;
    }

    if (typeof current !== def.type) {
      issues.push({
        code: COMMAND_ISSUE_CODES.ATTRIBUTE_TYPE,
        severity: 'error',
        message: `Атрибут «${def.label}» ожидает тип ${def.type}, а получил ${typeof current}.`,
        refs: [ref],
        path: `/attributes/${def.key}`,
      });
    }
  }

  return issues.length > 0 ? failWith(issues) : { ok: true, value };
}

/** Relations are recomputed after any edit that can move an object between zones. */
function withRelations(plan: PlanDocument): Result<PlanDocument> {
  return reconcileZones(plan);
}

function replaceById<T extends { id: Id }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  return items.map((item) => (item.id === next.id ? next : item));
}

function requireEntity(plan: PlanDocument, id: Id, kind: RefKind): Result<null> {
  const owner = idOwners(plan).get(id);
  if (owner !== kind) {
    return fail(
      CONTRACT_ISSUE_CODES.BROKEN_REF,
      `Сущность «${id}» (${kind}) не найдена в плане.`,
      [{ kind, id }],
    );
  }
  return { ok: true, value: null };
}

function putZone(plan: PlanDocument, zone: Zone): Result<PlanDocument> {
  const ref: Ref = { kind: 'zone', id: zone.id };

  const free = checkIdFree(plan, zone.id, 'zone');
  if (!free.ok) return free;

  const zoneType = plan.catalog.zoneTypes.find((type) => type.id === zone.typeId);
  if (zoneType === undefined) {
    return fail(
      CONTRACT_ISSUE_CODES.BROKEN_REF,
      `Тип зоны «${zone.typeId}» отсутствует в справочнике.`,
      [ref],
    );
  }

  const target = checkLayerEditable(plan, zone.layerId, ref);
  if (!target.ok) return target;

  const existing = plan.zones.find((item) => item.id === zone.id);
  if (existing !== undefined && existing.layerId !== zone.layerId) {
    const source = checkLayerEditable(plan, existing.layerId, ref);
    if (!source.ok) return source;
  }

  if (zone.parentId !== null) {
    const parent = plan.zones.find((item) => item.id === zone.parentId);
    if (parent === undefined) {
      return fail(
        CONTRACT_ISSUE_CODES.BROKEN_REF,
        `Родительская зона «${zone.parentId}» не существует.`,
        [ref, { kind: 'zone', id: zone.parentId }],
      );
    }
  }

  const attributes = normaliseAttributes(zoneType.attributes, zone.attributes, ref);
  if (!attributes.ok) return attributes;

  const zones = replaceById(plan.zones, { ...zone, attributes: attributes.value });
  if (hasZoneCycle(zones)) {
    return fail(
      CONTRACT_ISSUE_CODES.ZONE_CYCLE,
      `Зона «${zone.id}» замкнула вложенность в цикл.`,
      [ref],
    );
  }

  return withRelations({ ...plan, zones });
}

function deleteZone(plan: PlanDocument, id: Id): Result<PlanDocument> {
  const present = requireEntity(plan, id, 'zone');
  if (!present.ok) return present;

  const removed = plan.zones.find((zone) => zone.id === id)!;
  const editable = checkLayerEditable(plan, removed.layerId, { kind: 'zone', id });
  if (!editable.ok) return editable;

  // Children move up to the removed zone's parent so the hierarchy stays whole.
  const zones = plan.zones
    .filter((zone) => zone.id !== id)
    .map((zone) => (zone.parentId === id ? { ...zone, parentId: removed.parentId } : zone));

  return withRelations({ ...plan, zones });
}

function putObject(plan: PlanDocument, object: PlanDocument['objects'][number]): Result<PlanDocument> {
  const ref: Ref = { kind: 'object', id: object.id };

  const free = checkIdFree(plan, object.id, 'object');
  if (!free.ok) return free;

  const objectType = plan.catalog.objectTypes.find((type) => type.id === object.typeId);
  if (objectType === undefined) {
    return fail(
      CONTRACT_ISSUE_CODES.BROKEN_REF,
      `Тип объекта «${object.typeId}» отсутствует в справочнике.`,
      [ref],
    );
  }

  const target = checkLayerEditable(plan, object.layerId, ref);
  if (!target.ok) return target;

  const existing = plan.objects.find((item) => item.id === object.id);
  if (existing !== undefined && existing.layerId !== object.layerId) {
    const source = checkLayerEditable(plan, existing.layerId, ref);
    if (!source.ok) return source;
  }

  const attributes = normaliseAttributes(objectType.attributes, object.attributes, ref);
  if (!attributes.ok) return attributes;

  const objects = replaceById(plan.objects, { ...object, attributes: attributes.value });
  return withRelations({ ...plan, objects });
}

function deleteObject(plan: PlanDocument, id: Id): Result<PlanDocument> {
  const present = requireEntity(plan, id, 'object');
  if (!present.ok) return present;

  const removed = plan.objects.find((object) => object.id === id)!;
  const editable = checkLayerEditable(plan, removed.layerId, { kind: 'object', id });
  if (!editable.ok) return editable;

  return { ok: true, value: { ...plan, objects: plan.objects.filter((object) => object.id !== id) } };
}

function putLayer(plan: PlanDocument, layer: Layer): Result<PlanDocument> {
  const free = checkIdFree(plan, layer.id, 'layer');
  if (!free.ok) return free;

  // The layer entity itself stays editable while locked — otherwise a locked
  // layer could never be unlocked again.
  return { ok: true, value: { ...plan, layers: replaceById(plan.layers, layer) } };
}

function deleteLayer(plan: PlanDocument, id: Id, moveTo: Id): Result<PlanDocument> {
  const present = requireEntity(plan, id, 'layer');
  if (!present.ok) return present;

  if (plan.layers.length <= 1) {
    return fail(
      CONTRACT_ISSUE_CODES.NO_LAYERS,
      'В плане должен остаться хотя бы один слой.',
      [{ kind: 'layer', id }],
    );
  }

  const source = plan.layers.find((layer) => layer.id === id)!;
  if (source.locked) {
    return fail(
      COMMAND_ISSUE_CODES.LAYER_LOCKED,
      `Слой «${source.name}» заперт: сначала снимите замок.`,
      [{ kind: 'layer', id }],
    );
  }

  const destination = plan.layers.find((layer) => layer.id === moveTo);
  if (moveTo === id || destination === undefined || destination.locked) {
    return fail(
      COMMAND_ISSUE_CODES.MOVE_TARGET_INVALID,
      `Содержимое слоя нужно перенести в другой существующий и незапертый слой, «${moveTo}» не подходит.`,
      [{ kind: 'layer', id }, { kind: 'layer', id: moveTo }],
    );
  }

  return {
    ok: true,
    value: {
      ...plan,
      layers: plan.layers.filter((layer) => layer.id !== id),
      zones: plan.zones.map((zone) => (zone.layerId === id ? { ...zone, layerId: moveTo } : zone)),
      objects: plan.objects.map((object) =>
        object.layerId === id ? { ...object, layerId: moveTo } : object,
      ),
    },
  };
}

function replaceCatalog(plan: PlanDocument, catalog: Catalog): Result<PlanDocument> {
  const catalogIssues = validateCatalog(catalog).filter((issue) => issue.severity === 'error');
  if (catalogIssues.length > 0) return failWith(catalogIssues);

  const objectTypes = new Set(catalog.objectTypes.map((type) => type.id));
  const zoneTypes = new Set(catalog.zoneTypes.map((type) => type.id));

  const missing: Issue[] = [];
  for (const object of plan.objects) {
    if (!objectTypes.has(object.typeId)) {
      missing.push({
        code: CONTRACT_ISSUE_CODES.BROKEN_REF,
        severity: 'error',
        message: `Новый справочник не содержит тип «${object.typeId}», который используется объектом «${object.id}».`,
        refs: [{ kind: 'object', id: object.id }],
      });
    }
  }
  for (const zone of plan.zones) {
    if (!zoneTypes.has(zone.typeId)) {
      missing.push({
        code: CONTRACT_ISSUE_CODES.BROKEN_REF,
        severity: 'error',
        message: `Новый справочник не содержит тип зоны «${zone.typeId}», который используется зоной «${zone.id}».`,
        refs: [{ kind: 'zone', id: zone.id }],
      });
    }
  }
  if (missing.length > 0) return failWith(missing);

  return { ok: true, value: { ...plan, catalog } };
}

export function applyCommand(plan: PlanDocument, command: Command): Result<PlanDocument> {
  switch (command.type) {
    case 'room.set':
      return withRelations({ ...plan, room: { ...plan.room, boundary: command.boundary } });

    case 'zone.put':
      return putZone(plan, command.zone);

    case 'zone.delete':
      return deleteZone(plan, command.id);

    case 'object.put':
      return putObject(plan, command.object);

    case 'object.delete':
      return deleteObject(plan, command.id);

    case 'layer.put':
      return putLayer(plan, command.layer);

    case 'layer.delete':
      return deleteLayer(plan, command.id, command.moveTo);

    case 'wall.put': {
      const free = checkIdFree(plan, command.wall.id, 'wall');
      if (!free.ok) return free;
      return { ok: true, value: { ...plan, walls: replaceById(plan.walls, command.wall) } };
    }

    case 'wall.delete': {
      const present = requireEntity(plan, command.id, 'wall');
      if (!present.ok) return present;
      // Openings live on the wall: they disappear within the same undo step.
      return {
        ok: true,
        value: {
          ...plan,
          walls: plan.walls.filter((wall) => wall.id !== command.id),
          openings: plan.openings.filter((opening) => opening.wallId !== command.id),
        },
      };
    }

    case 'opening.put': {
      const free = checkIdFree(plan, command.opening.id, 'opening');
      if (!free.ok) return free;
      if (!plan.walls.some((wall) => wall.id === command.opening.wallId)) {
        return fail(
          CONTRACT_ISSUE_CODES.BROKEN_REF,
          `Стена «${command.opening.wallId}» для проёма не существует.`,
          [{ kind: 'opening', id: command.opening.id }],
        );
      }
      return {
        ok: true,
        value: { ...plan, openings: replaceById(plan.openings, command.opening) },
      };
    }

    case 'opening.delete': {
      const present = requireEntity(plan, command.id, 'opening');
      if (!present.ok) return present;
      return {
        ok: true,
        value: { ...plan, openings: plan.openings.filter((opening) => opening.id !== command.id) },
      };
    }

    case 'catalog.replace':
      return replaceCatalog(plan, command.catalog);

    case 'relations.reconcile':
      return withRelations(plan);
  }
}
