/**
 * #24: the menu of an object — what a right click or `Shift+F10` offers.
 *
 * The actions themselves are commands the app already has; this file only
 * names them. The object under a click is `findPlacementPick` with any type.
 */

import { ROTATION_SNAP_DEG } from './transform';

export type ObjectMenuAction = 'rotate' | 'duplicate' | 'delete' | 'inventory' | 'ask';

export const OBJECT_MENU_ITEMS: readonly { action: ObjectMenuAction; label: string; keys: string }[] = [
  { action: 'rotate', label: `Повернуть на ${ROTATION_SNAP_DEG}°`, keys: 'R' },
  { action: 'duplicate', label: 'Дублировать', keys: 'Ctrl+D' },
  { action: 'delete', label: 'Удалить', keys: 'Del' },
  { action: 'inventory', label: 'Показать в инвентаризации', keys: '' },
  { action: 'ask', label: 'Спросить ассистента', keys: '' },
];
