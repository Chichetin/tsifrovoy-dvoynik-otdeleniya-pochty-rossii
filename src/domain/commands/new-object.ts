/**
 * New objects of a catalog type (#68) — one rule for every way an object
 * enters the plan: a click from the library, a drawn «Своя фигура», a variant
 * of the assistant.
 *
 * `objectOfType` is the type's defaults at a spot: label, size, height,
 * attributes and outline from the catalog, no plan rules. The assistant's
 * search builds its probes with it. `newObject` is what a gesture puts on the
 * plan: a free `eq_` id, the first editable content layer and the next
 * inventory number of the plan's series (D-310), in one value, so placing and
 * numbering stay one command and one undo step.
 *
 * Copies (`Ctrl+C`/`Ctrl+V`, `Ctrl+D`) do not come here: a copy keeps an empty
 * number (D-311).
 */

import type { Equipment, Id, Layer, ObjectType, PlanDocument, Point } from '../../contracts/model';
import { defaultAttributes } from '../catalog';
import { editableContentLayer } from '../content-layer';
import { withTypeOutline } from '../geometry';
import { freshId } from './index';
import { withInventoryNumber } from './inventory-number';

/** Where a new object stands, in plan metres and degrees. */
export type ObjectSpot = { position: Point; rotation_deg: number };

/** The type's catalog defaults at a spot. No id choice, no layer choice, no number. */
export function objectOfType(type: ObjectType, spot: ObjectSpot & { id: Id; layerId: Id }): Equipment {
  // The type's shape (D-277): a round table is a round table from the start.
  return withTypeOutline(
    {
      id: spot.id,
      typeId: type.id,
      label: type.label,
      position: spot.position,
      size_m: [type.defaultSize_m[0], type.defaultSize_m[1]],
      rotation_deg: spot.rotation_deg,
      base_m: type.defaultBase_m,
      height_m: type.defaultHeight_m,
      zoneId: null,
      layerId: spot.layerId,
      attributes: defaultAttributes(type),
    },
    type,
  );
}

/**
 * The layer a new object goes to: the first unlocked content layer (D-063).
 * With every content layer locked, the first content layer anyway, so the store
 * refuses with «слой заперт» and the person learns why nothing was placed — a
 * silent no-op is not an outcome (D-174). `undefined` only for a plan without
 * a single content layer.
 */
export function newObjectLayer(plan: PlanDocument): Layer | undefined {
  return editableContentLayer(plan.layers) ?? plan.layers.find((entry) => entry.typeId === null);
}

/**
 * A new object as it enters the plan: a free `eq_` id (not on the plan, not
 * retired this session — D-019, D-198), the layer from `newObjectLayer`, the
 * type's defaults and the next inventory number when the type carries one.
 * `null` when the plan has no content layer to hold it.
 */
export function newObject(
  plan: PlanDocument,
  type: ObjectType,
  spot: ObjectSpot,
  retired: Iterable<Id> = [],
): Equipment | null {
  const layer = newObjectLayer(plan);
  if (layer === undefined) return null;
  const id = freshId('eq_', plan, retired);
  return withInventoryNumber(plan, objectOfType(type, { ...spot, id, layerId: layer.id }));
}
