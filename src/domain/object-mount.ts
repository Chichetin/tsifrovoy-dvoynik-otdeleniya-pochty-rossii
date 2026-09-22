import type { Equipment, Id, Layer, PlanDocument } from '../contracts/model';

/**
 * Team rule, not a Post norm (D-273): an object whose bottom is at least this
 * high above the floor hangs from the ceiling — cameras (2.6 m), fire sensors
 * (2.9), the HVAC unit (2.4), displays over the hall (2.0). Wall-mounted
 * things lower than that (media panel 1.8, alarm panel 1.4) count as floor.
 */
export const CEILING_BASE_M = 2.0;

export type ObjectMount = 'floor' | 'ceiling';

export const OBJECT_MOUNTS: readonly ObjectMount[] = ['floor', 'ceiling'];

/** The object's own `base_m`, not its type's: editing the bottom moves it between groups. */
export function objectMount(object: Pick<Equipment, 'base_m'>): ObjectMount {
  return object.base_m >= CEILING_BASE_M ? 'ceiling' : 'floor';
}

/** The ordinary layer the two groups split: the first content layer by order. */
export function mountScopeLayer(layers: readonly Layer[]): Layer | undefined {
  return layers
    .filter((layer) => layer.typeId === null)
    .sort((a, b) => a.order - b.order)[0];
}

export function countByMount(
  objects: readonly Equipment[],
  layerId: Id,
): Record<ObjectMount, number> {
  const counts: Record<ObjectMount, number> = { floor: 0, ceiling: 0 };
  for (const object of objects) {
    if (object.layerId === layerId) counts[objectMount(object)] += 1;
  }
  return counts;
}

/** Id of the view-only layer that carries hidden groups; never reaches a file. */
export const HIDDEN_MOUNT_LAYER_ID = '__hidden_mount';

/**
 * The document as the canvas and 3D should draw it: objects of a hidden group
 * are moved onto a hidden, locked view-only layer. Every drawing and picking
 * path already skips objects of invisible layers, and every object stays in
 * the document, so ids taken by a copy or paste still see them. The result is
 * for display only and must never be dispatched or saved.
 */
export function withHiddenMounts(
  plan: PlanDocument,
  layerId: Id,
  hidden: ReadonlySet<ObjectMount>,
): PlanDocument {
  if (hidden.size === 0) return plan;
  let moved = false;
  const objects = plan.objects.map((object) => {
    if (object.layerId !== layerId || !hidden.has(objectMount(object))) return object;
    moved = true;
    return { ...object, layerId: HIDDEN_MOUNT_LAYER_ID };
  });
  if (!moved) return plan;
  const viewLayer: Layer = {
    id: HIDDEN_MOUNT_LAYER_ID,
    name: HIDDEN_MOUNT_LAYER_ID,
    visible: false,
    locked: true,
    order: Number.MAX_SAFE_INTEGER,
    typeId: null,
  };
  return { ...plan, layers: [...plan.layers, viewLayer], objects };
}
