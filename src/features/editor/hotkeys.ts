/**
 * U02: клавиатура холста. Предикат отделён от компонента, потому что
 * «какая комбинация что делает» — это правило, а не разметка: его можно
 * проверить без DOM и без Konva.
 */

/** Поля события, которых достаточно, чтобы решить судьбу нажатия. */
export type HotkeyEvent = {
  /** Код клавиши, а не буква: на русской раскладке KeyF даёт «а» (D-128). */
  code: string;
  /**
   * Символ, который дала раскладка. Нужен ровно там, где договорённость
   * заключена о знаке, а не о клавише: «?» (D-280).
   */
  key: string;
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

/**
 * `?` показывает или прячет карту горячих клавиш.
 *
 * Здесь договорённость заключена о знаке, а не о клавише, поэтому одного
 * кода мало (D-280). На английской раскладке «?» — это `Shift+Slash`, и код
 * `Slash` ловит её при любой раскладке; но на русской знак вопроса живёт на
 * `Shift+7`, то есть на `Digit7`, и человек жмёт именно её — ту, где
 * нарисован «?». Раньше такое нажатие карту не закрывало: открыл кнопкой в
 * шапке, жмёшь «?» — ничего. Поэтому принимаются оба: символ «?», как его дала
 * раскладка, и физическая клавиша `Shift+Slash`, что бы она ни напечатала.
 */
export function isHotkeysMapHotkey(event: HotkeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  // Shift уже учтён самим знаком: «?» без Shift ни одна из раскладок не даёт.
  const typed = event.key === '?';
  if (!typed && !(event.code === 'Slash' && event.shiftKey)) return false;
  return !isTypingTarget(event.target);
}
