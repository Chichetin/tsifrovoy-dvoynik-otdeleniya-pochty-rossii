import type { Candidate } from '../../contracts/advice';
import type { Equipment, Id, PlanDocument } from '../../contracts/model';
import { nextFreeId, takenIds, withInventoryNumber } from '../commands';

/** A suggestion is an insertion, never an update of an existing object. */
export function candidateObjectForInsert(
  plan: PlanDocument,
  candidate: Candidate,
  retired: Iterable<Id>,
): Equipment {
  const taken = takenIds(plan, retired);
  const id = taken.has(candidate.object.id) ? nextFreeId('eq_', taken) : candidate.object.id;
  // Keep the answer/preview immutable; only the inserted entity gets a fresh ID
  // and, like a placement from the library, the next inventory number (D-310).
  return withInventoryNumber(plan, { ...candidate.object, id });
}
