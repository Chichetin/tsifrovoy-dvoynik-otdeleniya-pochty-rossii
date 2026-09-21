/**
 * U02: клавиатура холста. Предикат отделён от компонента, потому что
 * «какая комбинация что делает» — это правило, а не разметка: его можно
 * проверить без DOM и без Konva.
 */

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
  if (event.code !== 'KeyF') return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return !isTypingTarget(event.target);
}

/**
 * Ctrl+plus/minus changes the canvas scale around its centre. `Equal` and
 * `Minus` are physical keys, so the shortcut works on a Russian layout too;
 * the numpad codes cover a full-size keyboard.
 */
export function zoomHotkey(event: HotkeyEvent): 'in' | 'out' | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return null;
  if (event.code === 'Equal' || event.code === 'NumpadAdd') return 'in';
  if (event.code === 'Minus' || event.code === 'NumpadSubtract') return 'out';
  return null;
}

/**
 * История правок с клавиатуры: Ctrl+Z — отменить, Ctrl+Y и Ctrl+Shift+Z —
 * вернуть (второе — привычка macOS, там же вместо Ctrl работает Cmd).
 * Alt в сочетании — не наше; в поле ввода Ctrl+Z принадлежит тексту, а не
 * плану: отменять там должно набранную букву, а не поставленный стеллаж.
 */
export function historyHotkey(event: HotkeyEvent): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' && !event.shiftKey) return 'redo';
  return null;
}
