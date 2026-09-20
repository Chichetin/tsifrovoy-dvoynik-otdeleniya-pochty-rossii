/**
 * Minting identifiers for new entities — one rule for every tool (D-198).
 *
 * The plan's id space is shared by every kind of entity (a zone `z_1` and a
 * wall `z_1` cannot coexist, see `idOwners`), and an id a delete has retired
 * in this session must never come back (D-019, `PlanStore.retired`). So the
 * rule is: the first `<prefix><n>`, n from 1, that is neither on the plan nor
 * retired. Readable in the file, stable across reloads, and every caller —
 * placing an object, drawing a zone or a wall, pasting a group — gets an id
 * instead of a copy of the rule.
 */

import type { Id } from '../../contracts/model';

/** First `<prefix><n>` not in `taken`; `taken` is extended so a loop can mint several. */
export function nextFreeId(prefix: string, taken: Set<Id>): Id {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
