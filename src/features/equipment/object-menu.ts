/**
 * #24: the menu of an object — what a right click or `Shift+F10` offers.
 *
 * The actions themselves are commands the app already has; this file only
 * names them and finds the object under a click.
 */

import type { Equipment, PlanDocument, Point } from '../../contracts/model';
import { distanceToObject } from './placement-pick';
import { ROTATION_SNAP_DEG } from './transform';

export type ObjectMenuAction = 'rotate' | 'duplicate' | 'delete' | 'inventory' | 'ask';

export const OBJECT_MENU_ITEMS: readonly { action: ObjectMenuAction; label: string; keys: string }[] = [
  { action: 'rotate', label: `Повернуть на ${ROTATION_SNAP_DEG}°`, keys: 'R' },
  { action: 'duplicate', label: 'Дублировать', keys: 'Ctrl+D' },
  { action: 'delete', label: 'Удалить', keys: 'Del' },
  { action: 'inventory', label: 'Показать в инвентаризации', keys: '' },
  { action: 'ask', label: 'Спросить ассистента', keys: '' },
];

/** Same reach as a pick on the plan: a near miss counts at every zoom level. */
const MENU_PICK_TOLERANCE_PX = 8;

/**
 * The object a click at `point` means: the one under it, the upper one when
 * several overlap, or the nearest within a few pixels. Objects on a hidden
 * layer are not on the screen and are not offered.
 */
export function objectAtPoint(plan: PlanDocument, point: Point, scale: number): Equipment | null {
  if (scale <= 0) return null;
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const tolerance_m = MENU_PICK_TOLERANCE_PX / scale;
  let found: Equipment | null = null;
  let foundDistance = Number.POSITIVE_INFINITY;
  for (const object of plan.objects) {
    if (!visible.has(object.layerId)) continue;
    const distance = distanceToObject(point, object);
    // `<=` makes the later, visually upper object win an exact tie.
    if (distance > tolerance_m || distance > foundDistance) continue;
    found = object;
    foundDistance = distance;
  }
  return found;
}

/** The question «Спросить ассистента» sends: everything the answer is built from is named in it. */
export function objectQuestion(object: Equipment): string {
  return `Что известно про «${object.label}» (${object.id}): в какой он зоне, какие правила комплектования его касаются и что стоит изменить?`;
}
