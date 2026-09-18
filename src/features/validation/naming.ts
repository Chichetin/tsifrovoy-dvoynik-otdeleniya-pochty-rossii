/**
 * V02 (naming): the human name behind an id in a finding.
 *
 * A finding says «eq_31 пересекает eq_12» — true, checkable and unreadable to
 * the person who has to fix it. The name comes from the document itself, so
 * renaming an object in the card renames it in the list; an id with nothing
 * behind it (deleted mid-edit, or a wall that has no name at all) returns
 * `null` and the panel keeps showing the raw id.
 */

import type { PlanDocument, Ref } from '../../contracts/model';

export function refName(plan: PlanDocument | undefined, ref: Ref): string | null {
  if (plan === undefined) return null;
  switch (ref.kind) {
    case 'object':
      return plan.objects.find((object) => object.id === ref.id)?.label ?? null;
    case 'zone':
      return plan.zones.find((zone) => zone.id === ref.id)?.name ?? null;
    case 'layer':
      return plan.layers.find((layer) => layer.id === ref.id)?.name ?? null;
    case 'room':
      return plan.room.id === ref.id ? 'Помещение' : null;
    // Walls and openings carry no name of their own: the id is all there is.
    default:
      return null;
  }
}
