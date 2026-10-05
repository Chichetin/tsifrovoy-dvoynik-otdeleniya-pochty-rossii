/**
 * #26: the silhouette shown while a library type is armed or dragged over the
 * plan. It is the object a click would place, in the colour of the answer the
 * store gives: the same object (`placedObject`) and the same two checks
 * (`applyCommand`, then `editRejection`), so green means «accepted» and red
 * means «refused» before the button is released.
 */

import { TOLERANCE, type Equipment, type Id, type ObjectType, type PlanDocument, type Point } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';
import { applyCommand, newObject } from '../../domain/commands';
import { contains, footprint, locatePoint } from '../../domain/geometry';
import { editRejection, objectPhysicsIssues } from '../../domain/physics';
import { isDeskEquipment, WORK_SURFACE_M } from '../../domain/validation';
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
  const object = newObject(
    plan,
    type,
    { position: placement?.position ?? snapPosition(point), rotation_deg: placement?.rotation_deg ?? 0 },
    retired,
  );
  if (object === null || !isDeskEquipment(plan.catalog, object)) return object;
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  // The catalog's work-surface height identifies tables without hard-coded
  // type ids. Their actual height may have been edited in the properties card.
  for (const support of plan.objects.toReversed()) {
    const supportType = findObjectType(plan.catalog, support.typeId);
    if (!visible.has(support.layerId) || supportType?.physical !== true || !supportType.occupiesFloor ||
        Math.abs(supportType.defaultHeight_m - WORK_SURFACE_M) > TOLERANCE.coordinate_m) continue;
    const surface = footprint(support);
    if (locatePoint(point, surface) === 'outside') continue;
    const mounted = { ...object, rotation_deg: support.rotation_deg, base_m: support.base_m + support.height_m };
    if (contains(surface, footprint(mounted))) return mounted;
    // A click near a table edge still means that table. Centre the device if
    // it fits there; a too-small/custom surface stays refused by the same check.
    const centred = { ...mounted, position: support.position };
    if (contains(surface, footprint(centred))) return centred;
  }
  return object;
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

/**
 * #179: the assistant's chosen place for an object — a dashed outline where it
 * would stand and an arrow from where it stands now (null for a new object).
 * The assistant is another feature and cannot import this file: it fires
 * `SUGGESTION_GHOST_EVENT` with this shape or null as `detail`
 * (`features/assistant/place-suggestion.ts`, the same name).
 */
export type SuggestionGhost = { from: Point | null; to: Equipment; label: string };

export const SUGGESTION_GHOST_EVENT = 'ops-twin:suggestion-ghost';

let suggestion: SuggestionGhost | null = null;
const suggestionListeners = new Set<() => void>();

function suggestionOf(detail: unknown): SuggestionGhost | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { to, from, label } = detail as Partial<SuggestionGhost>;
  if (to === undefined || !Array.isArray(to.position) || !Array.isArray(to.size_m)) return null;
  return { to, from: Array.isArray(from) ? from : null, label: typeof label === 'string' ? label : '' };
}

// Listens from the first import, not from the first render: an answer chosen
// while the canvas remounts is still drawn.
if (typeof window !== 'undefined') {
  window.addEventListener(SUGGESTION_GHOST_EVENT, (event) => {
    suggestion = suggestionOf((event as CustomEvent<unknown>).detail);
    for (const listener of suggestionListeners) listener();
  });
}

export const suggestionGhost = {
  subscribe(listener: () => void): () => void {
    suggestionListeners.add(listener);
    return () => suggestionListeners.delete(listener);
  },
  getSnapshot: (): SuggestionGhost | null => suggestion,
};
