/**
 * #26: the silhouette shown while a library type is armed or dragged over the
 * plan. It is the object a click would place, in the colour of the answer the
 * store gives: the same object (`placedObject`) and the same two checks
 * (`applyCommand`, then `editRejection`), so green means «accepted» and red
 * means «refused» before the button is released.
 */

import type { Equipment, Id, ObjectType, PlanDocument, Point } from '../../contracts/model';
import { applyCommand, newObject } from '../../domain/commands';
import { editRejection, objectPhysicsIssues } from '../../domain/physics';
import { snapPosition } from './transform';
import { isWallMounted, wallMountPlacement } from './wall-mount';

/**
 * The object a click at `point` places. Wall-mounted equipment (D-228) is
 * pressed to the nearest wall and faces into the room: a camera at
 * `rotation_deg: 0` would aim its cone into the wall wherever it stands. Other
 * types stand exactly under the pointer, to the centimetre like every gesture.
 * `null` when the type has no layer to hold it.
 */
export function placedObject(
  plan: PlanDocument,
  type: ObjectType,
  point: Point,
  retired: Iterable<Id> = [],
): Equipment | null {
  const placement = isWallMounted(type)
    ? wallMountPlacement(plan.walls, plan.room.boundary, type.defaultSize_m, point)
    : null;
  // Id, layer, catalog defaults and the next inventory number (D-310) come from
  // one rule for every new object.
  return newObject(
    plan,
    type,
    { position: placement?.position ?? snapPosition(point), rotation_deg: placement?.rotation_deg ?? 0 },
    retired,
  );
}

/**
 * The answer for one object: `refusal` — why the store would not take it;
 * `warning` — it is taken, but the check will find a violation at once (outside
 * the room, in a wall) and the file will not leave the editor without a second
 * confirmation. Both null — a clean place.
 */
export type PlacementVerdict = { refusal: string | null; warning: string | null };

export function placementVerdict(plan: PlanDocument, object: Equipment, retired: Iterable<Id> = []): PlacementVerdict {
  const command = { type: 'object.put', object } as const;
  const after = applyCommand(plan, command, retired);
  if (!after.ok) return { refusal: after.issues[0]?.message ?? 'Правка отклонена.', warning: null };
  const refused = editRejection(plan, after.value, command, retired);
  if (refused !== null) return { refusal: refused.message, warning: null };
  const placed = after.value.objects.find((entry) => entry.id === object.id);
  return { refusal: null, warning: placed === undefined ? null : (objectPhysicsIssues(after.value, placed)[0]?.message ?? null) };
}

/** Why the store would refuse to put `object` on the plan; null when it would accept. */
export function placementRefusal(plan: PlanDocument, object: Equipment, retired: Iterable<Id> = []): string | null {
  return placementVerdict(plan, object, retired).refusal;
}

export type PlacementGhost = PlacementVerdict & { object: Equipment };

/**
 * The silhouette moves at pointer rate, so it lives in a store of its own:
 * only the layer that draws it re-renders, not the app around it.
 */
let ghost: PlacementGhost | null = null;
const listeners = new Set<() => void>();

export const placementGhost = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): PlacementGhost | null => ghost,
  publish(next: PlacementGhost | null): void {
    const same =
      ghost === next ||
      (ghost !== null &&
        next !== null &&
        ghost.refusal === next.refusal &&
        ghost.warning === next.warning &&
        ghost.object.position[0] === next.object.position[0] &&
        ghost.object.position[1] === next.object.position[1] &&
        ghost.object.rotation_deg === next.object.rotation_deg &&
        ghost.object.typeId === next.object.typeId);
    if (same) return;
    ghost = next;
    for (const listener of listeners) listener();
  },
};
