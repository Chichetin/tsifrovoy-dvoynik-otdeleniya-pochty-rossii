import type { Equipment, Id, PlanDocument } from '../../contracts/model';

export type InventoryLinkTarget = { planId: Id; objectId: Id };
export type InventoryLinkResolution =
  | { status: 'found'; object: Equipment }
  | { status: 'different-plan' | 'missing-object' };

/** A label points at both the document and the object; object IDs alone are not global. */
export function inventoryObjectLink(baseUrl: string, target: InventoryLinkTarget): string | null {
  if (!target.planId || !target.objectId) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // A copied editor address may contain credentials or unrelated query data.
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    url.searchParams.set('plan', target.planId);
    url.searchParams.set('object', target.objectId);
    return url.href;
  } catch {
    return null;
  }
}

export function inventoryLinkTarget(search: string): InventoryLinkTarget | null {
  const params = new URLSearchParams(search);
  const plans = params.getAll('plan');
  const objects = params.getAll('object');
  if (plans.length !== 1 || objects.length !== 1 || !plans[0] || !objects[0]) return null;
  return { planId: plans[0], objectId: objects[0] };
}

/** Resolve only against the right file. A missing file must be loaded, never substituted. */
export function resolveInventoryLink(plan: PlanDocument, target: InventoryLinkTarget): InventoryLinkResolution {
  if (plan.id !== target.planId) return { status: 'different-plan' };
  const object = plan.objects.find((entry) => entry.id === target.objectId);
  return object === undefined ? { status: 'missing-object' } : { status: 'found', object };
}
