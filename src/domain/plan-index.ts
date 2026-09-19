/**
 * One answer to «what is this id called» (D-202).
 *
 * Findings, the inventory and the assistant all turn ids into names for the
 * person reading them: an object's label, a zone's name, a type's label. Each
 * panel used to search the plan its own way, with its own answer for «nothing
 * behind the id». This index is built once per document, looks up in O(1),
 * and answers the same everywhere: `null` when the plan has no such entity,
 * so the caller decides how to show a raw id — never a made-up name.
 */

import type { Id, PlanDocument, Ref } from '../contracts/model';

export type PlanIndex = {
  /** Human name of an entity, or null: walls and openings carry no name. */
  nameOf(ref: Ref): string | null;
  objectLabel(id: Id): string | null;
  zoneName(id: Id): string | null;
  layerName(id: Id): string | null;
  /** Catalog labels: object type and zone type. */
  objectTypeLabel(typeId: Id): string | null;
  zoneTypeLabel(typeId: Id): string | null;
};

/** Name the room answers to: the plan has exactly one, and it has no name field. */
export const ROOM_NAME = 'Помещение';

export function planIndex(plan: PlanDocument): PlanIndex {
  const objects = new Map(plan.objects.map((object) => [object.id, object.label]));
  const zones = new Map(plan.zones.map((zone) => [zone.id, zone.name]));
  const layers = new Map(plan.layers.map((layer) => [layer.id, layer.name]));
  const objectTypes = new Map(plan.catalog.objectTypes.map((type) => [type.id, type.label]));
  const zoneTypes = new Map(plan.catalog.zoneTypes.map((type) => [type.id, type.label]));
  const get = (map: Map<Id, string>, id: Id): string | null => map.get(id) ?? null;
  return {
    objectLabel: (id) => get(objects, id),
    zoneName: (id) => get(zones, id),
    layerName: (id) => get(layers, id),
    objectTypeLabel: (id) => get(objectTypes, id),
    zoneTypeLabel: (id) => get(zoneTypes, id),
    nameOf: (ref) => {
      switch (ref.kind) {
        case 'object':
          return get(objects, ref.id);
        case 'zone':
          return get(zones, ref.id);
        case 'layer':
          return get(layers, ref.id);
        case 'room':
          return plan.room.id === ref.id ? ROOM_NAME : null;
        default:
          return null;
      }
    },
  };
}

/** An index over nothing: every lookup is null. For a panel rendered without a document. */
export const EMPTY_INDEX: PlanIndex = {
  nameOf: () => null,
  objectLabel: () => null,
  zoneName: () => null,
  layerName: () => null,
  objectTypeLabel: () => null,
  zoneTypeLabel: () => null,
};
