/** Что показывает карточка, пока указатель стоит на предмете. */

import type { Equipment } from '../../contracts/model';

export type EquipmentHoverSummary = {
  /** Имя предмета — единственное содержимое карточки. */
  title: string;
  /** Куда идти за подробностями: карточка наведения их не заменяет. */
  hint: string;
};

/**
 * Подсказка говорит, что карточка наведения — не паспорт объекта: тип,
 * атрибуты, зона, размеры и находки проверки открываются по клику в
 * «Свойствах».
 */
export const HOVER_HINT = 'Нажмите на сам предмет на плане — справа откроются «Свойства»';
export const HOVER_TOOL_HINT = 'Для подробностей включите «Выбор» сверху и нажмите на сам предмет на плане';

export function equipmentHoverHint(picking: boolean, learned = false): string {
  return learned ? '' : picking ? HOVER_HINT : HOVER_TOOL_HINT;
}

/**
 * Карточка отвечает на один вопрос — «что это за предмет» — и называет его так
 * же, как перечень оборудования. Всё остальное читается с одного взгляда хуже,
 * чем открывается кликом, поэтому сюда не попадает (заказ участника 22.09).
 */
export function equipmentHoverSummary(object: Equipment, picking = true, learned = false): EquipmentHoverSummary {
  return { title: object.label, hint: equipmentHoverHint(picking, learned) };
}

/** Local UI learning, never part of a saved plan. Private mode may deny storage. */
const HOVER_LEARNED_KEY = 'posttech.equipment-selection-learned.v1';

export function hasLearnedEquipmentSelection(): boolean {
  try { return window.localStorage.getItem(HOVER_LEARNED_KEY) === '1'; }
  catch { return false; }
}

export function rememberEquipmentSelection(): void {
  try { window.localStorage.setItem(HOVER_LEARNED_KEY, '1'); }
  catch { /* The current layer still remembers it in memory. */ }
}
