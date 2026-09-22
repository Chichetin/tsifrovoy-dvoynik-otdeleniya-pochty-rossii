/**
 * U03: Enter after placing or picking a proem ends its focus the same way an
 * Enter that closes a ring does — the card disappears, as if placement were
 * final. Picking up a different tool does the same thing (заказ от 22.09):
 * a card left open for a proem the new tool cannot touch is a stale card.
 *
 * Neither rule fires while a room, zone or wall draft is still on screen:
 * that Enter already belongs to `use-plan-tool-controller.ts` (D-262). In
 * practice a proem never stays selected once one of those tools takes over
 * — a tool switch drops the selection first — so the two rules never really
 * compete, but the `hasDraft` guard is kept anyway: a silent coincidence is
 * worse than a defensive check nobody happens to exercise.
 */
import type { Ref } from '../../contracts/model';

/**
 * True when the current selection is a proem and nothing else has a claim
 * on Enter (or, for a tool switch, when there is nothing to guard at all).
 */
export function shouldFinishOpeningSelection(selection: Ref | null, hasDraft = false): boolean {
  return !hasDraft && selection !== null && selection.kind === 'opening';
}
