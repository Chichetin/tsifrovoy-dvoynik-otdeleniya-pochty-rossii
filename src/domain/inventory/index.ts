/**
 * M01: the inventory — what stands in the branch, counted by type and by zone.
 *
 * This is a derived view, never a second copy of the plan: it holds no state
 * and is recomputed from the document, so a move or a deletion in the editor
 * cannot leave the inventory saying something else.
 *
 * The one arithmetic trap here is nesting. A bench in `z_waiting`, which sits
 * inside `z_client`, counts once for `z_waiting` directly and once more for
 * every ancestor in the inclusive tally. So `byZoneDirect` may be summed to a
 * total and `byZoneInclusive` may not — that is exactly the double count that
 * makes the areas in the organizers' example add up to more than the room.
 */

import type { Equipment, Id, Inventory, PlanDocument, Zone } from '../../contracts/model';

/**
 * Counts the plan. Every zone of the document and every type of its catalog
 * gets an entry, including the empty ones: a type just added to the catalog is
 * visible in the table with a zero rather than missing from it.
 *
 * An object whose `zoneId` points at a zone that is not in the document counts
 * as unassigned. The schema refuses such a document on load, so this only
 * happens mid-edit; counting it nowhere would silently lose it from the total.
 */
export function buildInventory(plan: PlanDocument): Inventory {
  const parents = zoneParents(plan.zones);

  const byType: Record<Id, number> = {};
  for (const type of plan.catalog.objectTypes) byType[type.id] = 0;

  const byZoneDirect: Record<Id, number> = {};
  const byZoneInclusive: Record<Id, number> = {};
  for (const zone of plan.zones) {
    byZoneDirect[zone.id] = 0;
    byZoneInclusive[zone.id] = 0;
  }

  let unassigned = 0;

  for (const object of plan.objects) {
    byType[object.typeId] = (byType[object.typeId] ?? 0) + 1;

    const zoneId = object.zoneId;
    if (zoneId === null || !parents.has(zoneId)) {
      unassigned += 1;
      continue;
    }

    byZoneDirect[zoneId] = (byZoneDirect[zoneId] ?? 0) + 1;
    for (const ancestor of chainFrom(zoneId, parents)) {
      byZoneInclusive[ancestor] = (byZoneInclusive[ancestor] ?? 0) + 1;
    }
  }

  return { rows: rowsOf(plan.objects), byType, byZoneDirect, byZoneInclusive, unassigned };
}

/** Rows in document order: the table must not reshuffle itself between edits. */
function rowsOf(objects: Equipment[]): Equipment[] {
  return [...objects];
}

function zoneParents(zones: Zone[]): Map<Id, Id | null> {
  const parents = new Map<Id, Id | null>();
  for (const zone of zones) parents.set(zone.id, zone.parentId);
  return parents;
}

/**
 * The zone itself and every ancestor above it, each visited once. The guard is
 * not decoration: the schema rejects a cycle on load, but the inventory is also
 * recomputed on intermediate states, and a cycle there must not hang the editor.
 */
function chainFrom(zoneId: Id, parents: Map<Id, Id | null>): Id[] {
  const chain: Id[] = [];
  const seen = new Set<Id>();
  let current: Id | null = zoneId;

  while (current !== null && parents.has(current) && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = parents.get(current) ?? null;
  }
  return chain;
}
