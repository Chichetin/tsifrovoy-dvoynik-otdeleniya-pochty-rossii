/**
 * U02: клавиатура холста. Предикат отделён от компонента, потому что
 * «какая комбинация что делает» — это правило, а не разметка: его можно
 * проверить без DOM и без Konva.
 *
 * Два шага: `hotkeyAction` решает, что значит нажатие, `hotkeyCommand`
 * переводит действие в обычную команду документа. Стрелки и Ctrl+D — это
 * тот же `object.put`, что шлёт жест перетаскивания, поэтому связь с зоной
 * пересчитывается там же, а одно нажатие — один шаг истории (D-179).
 */

import type { Command } from '../../contracts/commands';
import type { Equipment, Id, PlanDocument, Point, Ref } from '../../contracts/model';
import { defaultAttributes, findObjectType } from '../../domain/catalog';
import { idOwners } from '../../domain/commands';

/** Поля события, которых достаточно, чтобы решить судьбу нажатия. */
export type HotkeyEvent = {
  /** Код клавиши, а не буква: на русской раскладке KeyF даёт «а» (D-128). */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

/** Hotkeys belong to the plan, not to a text field the user is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Свойство есть не в каждой среде (jsdom его не реализует), а тип обещает
  // boolean: без приведения предикат возвращал undefined.
  return target.isContentEditable === true;
}

/**
 * Вписать план — это «голая» F. Любой модификатор оставляет нажатие
 * браузеру и приложению: Ctrl+F — поиск, Shift+F — заглавная буква, и ни то
 * ни другое не должно молча сбрасывать масштаб.
 */
export function isFitHotkey(event: HotkeyEvent): boolean {
  return hotkeyAction(event)?.kind === 'fit';
}

export type HotkeyAction =
  | { kind: 'fit' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  /** Shift in model metres: X right, Y up (D-010). */
  | { kind: 'nudge'; delta: Point }
  | { kind: 'duplicate' };

/** Шаг стрелки и шаг с Shift, м. */
export const NUDGE_STEP_M = 0.1;
export const NUDGE_BIG_STEP_M = 1;

/** Копия встаёт вправо-вниз на экране: +X и −Y модели. */
export const DUPLICATE_OFFSET_M: Point = [0.5, -0.5];

/** Screen direction of each arrow, already in model axes (Y up). */
const ARROWS: Record<string, Point> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/**
 * Что значит нажатие для плана, или null — нажатие принадлежит полю ввода,
 * браузеру или никому. Решает `event.code`, а не буква: на русской раскладке
 * Ctrl+Z приходит с `key === 'я'` (D-128).
 */
export function hotkeyAction(event: HotkeyEvent): HotkeyAction | null {
  if (isTypingTarget(event.target)) return null;
  // Alt меняет смысл любого сочетания (Ctrl+Alt+Z, AltGr на части раскладок).
  if (event.altKey) return null;
  const command = event.ctrlKey || event.metaKey;

  if (command) {
    if (event.code === 'KeyZ') return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    // Cmd+Y в браузерах на macOS — история посещений, её не трогаем.
    if (event.code === 'KeyY' && event.ctrlKey && !event.shiftKey) return { kind: 'redo' };
    if (event.code === 'KeyD' && !event.shiftKey) return { kind: 'duplicate' };
    // Ctrl+F, Ctrl+C, Ctrl+стрелка и прочее остаются браузеру.
    return null;
  }

  const arrow = ARROWS[event.code];
  if (arrow !== undefined) {
    const step = event.shiftKey ? NUDGE_BIG_STEP_M : NUDGE_STEP_M;
    // `+ 0` превращает −0 в 0: сдвиг по одной оси не несёт знак по другой.
    return { kind: 'nudge', delta: [arrow[0] * step + 0, arrow[1] * step + 0] };
  }

  // Вписать план — «голая» F: Shift+F — заглавная буква, а не масштаб.
  if (event.code === 'KeyF' && !event.shiftKey) return { kind: 'fit' };
  return null;
}

/** Centimetres, like every gesture: ten steps of 0.1 land on a whole metre. */
function toCentimetre(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextId(prefix: string, taken: ReadonlySet<Id>): Id {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The selected object the keyboard may act on: it exists and its layer is
 * visible. A hidden object is out of reach, like for Delete; a locked one is
 * left to the store, whose refusal the user sees.
 */
function selectedObject(plan: PlanDocument, selection: Ref | null): Equipment | null {
  if (selection?.kind !== 'object') return null;
  const object = plan.objects.find((item) => item.id === selection.id);
  if (object === undefined) return null;
  const layer = plan.layers.find((item) => item.id === object.layerId);
  return layer?.visible === true ? object : null;
}

/**
 * Команда документа для нажатия, или null, если плану делать нечего.
 * История и вписывание — не команды: их выполняет вызывающий.
 *
 * Копия получает атрибуты по умолчанию из справочника, а не атрибуты
 * оригинала: инвентарный номер, номер окна и места принадлежат экземпляру,
 * и две единицы с одним номером испортили бы инвентаризацию (D-179).
 */
export function hotkeyCommand(
  action: HotkeyAction,
  plan: PlanDocument,
  selection: Ref | null,
  retired: ReadonlySet<Id>,
): Command | null {
  if (action.kind !== 'nudge' && action.kind !== 'duplicate') return null;
  const object = selectedObject(plan, selection);
  if (object === null) return null;

  if (action.kind === 'nudge') {
    const position: Point = [
      toCentimetre(object.position[0] + action.delta[0]),
      toCentimetre(object.position[1] + action.delta[1]),
    ];
    return { type: 'object.put', object: { ...object, position } };
  }

  // Everything on the plan plus ids retired this session (D-019).
  const taken = new Set<Id>([...idOwners(plan).keys(), ...retired]);
  const type = findObjectType(plan.catalog, object.typeId);
  return {
    type: 'object.put',
    object: {
      ...object,
      id: nextId('eq_', taken),
      position: [
        toCentimetre(object.position[0] + DUPLICATE_OFFSET_M[0]),
        toCentimetre(object.position[1] + DUPLICATE_OFFSET_M[1]),
      ],
      attributes: type === null ? {} : defaultAttributes(type),
    },
  };
}
