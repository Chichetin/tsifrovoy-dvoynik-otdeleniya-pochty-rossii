// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { type HotkeyEvent, historyHotkey, isFitHotkey, isTypingTarget } from './hotkeys';

function event(patch: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return {
    code: 'KeyF',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...patch,
  };
}

describe('клавиша вписывания', () => {
  it('срабатывает на голую F', () => {
    expect(isFitHotkey(event())).toBe(true);
  });

  it('не зависит от раскладки: решает код клавиши, а не буква (D-128)', () => {
    // На русской раскладке та же физическая клавиша даёт «а»; кода это не меняет.
    expect(isFitHotkey(event({ code: 'KeyF' }))).toBe(true);
    expect(isFitHotkey(event({ code: 'KeyA' }))).toBe(false);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
  ])('не срабатывает с модификатором %s', (_name, patch) => {
    expect(isFitHotkey(event(patch))).toBe(false);
  });

  it('молчит, пока пользователь печатает', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isFitHotkey(event({ target: document.createElement(tag) }))).toBe(false);
    }
    // jsdom не реализует isContentEditable, поэтому свойство задано явно:
    // проверяем правило предиката, а не полноту среды.
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isFitHotkey(event({ target: editable }))).toBe(false);
  });

  it('обычный элемент полем ввода не считается', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('история правок с клавиатуры', () => {
  const ctrl = { ctrlKey: true };

  it('Ctrl+Z — отменить, Ctrl+Y и Ctrl+Shift+Z — вернуть', () => {
    expect(historyHotkey(event({ code: 'KeyZ', ...ctrl }))).toBe('undo');
    expect(historyHotkey(event({ code: 'KeyY', ...ctrl }))).toBe('redo');
    expect(historyHotkey(event({ code: 'KeyZ', ...ctrl, shiftKey: true }))).toBe('redo');
  });

  it('Cmd работает как Ctrl', () => {
    expect(historyHotkey(event({ code: 'KeyZ', metaKey: true }))).toBe('undo');
    expect(historyHotkey(event({ code: 'KeyZ', metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('решает код клавиши, а не буква: на русской раскладке Ctrl+Я — та же Ctrl+Z', () => {
    expect(historyHotkey(event({ code: 'KeyZ', ...ctrl }))).toBe('undo');
    expect(historyHotkey(event({ code: 'KeyA', ...ctrl }))).toBeNull();
  });

  it('без Ctrl, с Alt и Ctrl+Shift+Y — не наше', () => {
    expect(historyHotkey(event({ code: 'KeyZ' }))).toBeNull();
    expect(historyHotkey(event({ code: 'KeyZ', ...ctrl, altKey: true }))).toBeNull();
    expect(historyHotkey(event({ code: 'KeyY', ...ctrl, shiftKey: true }))).toBeNull();
  });

  it('в поле ввода отменяется текст, а не план', () => {
    expect(historyHotkey(event({ code: 'KeyZ', ...ctrl, target: document.createElement('input') }))).toBeNull();
  });
});
