/**
 * #24: the menu of an object — what a right click or `Shift+F10` offers.
 *
 * The actions themselves are commands the app already has; this file only
 * names them. «Предложить место» (#179) goes to the assistant as a window
 * event (`SUGGEST_PLACE_EVENT`): the menu fires it, the app is not involved. The object under a click is `findPlacementPick` with any type.
 */

import { ROTATION_SNAP_DEG } from './transform';

export type ObjectMenuAction = 'rotate' | 'duplicate' | 'delete' | 'inventory' | 'place' | 'ask';

export const OBJECT_MENU_ITEMS: readonly { action: ObjectMenuAction; label: string; keys: string }[] = [
  { action: 'rotate', label: `Повернуть на ${ROTATION_SNAP_DEG}°`, keys: 'R' },
  { action: 'duplicate', label: 'Дублировать', keys: 'Ctrl+D' },
  { action: 'delete', label: 'Удалить', keys: 'Del' },
  { action: 'inventory', label: 'Показать в инвентаризации', keys: '' },
  { action: 'place', label: 'Предложить место', keys: '' },
  { action: 'ask', label: 'Спросить ассистента', keys: '' },
];

/** The same name as in `features/assistant/place-suggestion.ts`; `detail` is `{ objectId }`. */
export const SUGGEST_PLACE_EVENT = 'ops-twin:suggest-place';
