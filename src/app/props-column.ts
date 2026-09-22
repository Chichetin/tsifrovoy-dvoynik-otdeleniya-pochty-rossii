/**
 * D-268: «Свойства» take the left column in place of «Библиотека»/«Слои».
 *
 * The right column (assistant, checks, inventory) stays open while something
 * is selected; the left one is not needed at that moment, so the card stands
 * in for its open tab. The row of left tabs stays: a click on a tab brings the
 * panel back for this very selection without dropping it, and the next pick
 * shows the card again. No DOM here — App keeps one piece of state, the
 * selection the card was sent away for, and asks this module what to show.
 */

import type { Ref } from '../contracts/model';
import type { LeftTab } from './side-tabs';

export function sameRef(a: Ref | null, b: Ref | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Whether the card stands in the left column. A layer has no card of its own
 * (its settings live in «Слои», and focusing a layer's name selects it), so a
 * layer selection never covers the layers panel it came from.
 */
export function showsPropsCard(selection: Ref | null, hiddenFor: Ref | null): boolean {
  if (selection === null || selection.kind === 'layer') return false;
  return !sameRef(selection, hiddenFor);
}

/** The band over the card names the panel it replaced. */
export function replacedTitle(left: LeftTab): string {
  return left === 'library' ? 'Свойства — вместо библиотеки' : 'Свойства — вместо слоёв';
}
