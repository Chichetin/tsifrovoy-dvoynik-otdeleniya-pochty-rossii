import { describe, expect, it } from 'vitest';
import { hotkeyAlternatives } from './hotkey-chord';
import { HOTKEYS_MAP } from './hotkeys-map';

const key = (label: string) => ({ kind: 'key', label }) as const;
const plus = { kind: 'plus' } as const;
const then = { kind: 'then' } as const;

describe('hotkeyAlternatives', () => {
  it('одна клавиша — один блок', () => {
    expect(hotkeyAlternatives('F')).toEqual([[key('F')]]);
    expect(hotkeyAlternatives('?')).toEqual([[key('?')]]);
  });

  it('«+» без пробелов и с пробелами даёт соединитель между блоками', () => {
    expect(hotkeyAlternatives('Ctrl+Shift+Z')).toEqual([[key('Ctrl'), plus, key('Shift'), plus, key('Z')]]);
    expect(hotkeyAlternatives('Shift + стрелка')).toEqual([[key('Shift'), plus, key('стрелка')]]);
  });

  it('«или» и « / » делят сочетание на варианты', () => {
    expect(hotkeyAlternatives('Delete или Backspace')).toEqual([[key('Delete')], [key('Backspace')]]);
    expect(hotkeyAlternatives('Ctrl+Shift+Z или Ctrl+Y')).toEqual([
      [key('Ctrl'), plus, key('Shift'), plus, key('Z')],
      [key('Ctrl'), plus, key('Y')],
    ]);
    expect(hotkeyAlternatives('Esc / Enter')).toEqual([[key('Esc')], [key('Enter')]]);
  });

  it('«затем» — последовательность внутри одного варианта', () => {
    expect(hotkeyAlternatives('Ctrl+C затем Ctrl+V')).toEqual([
      [key('Ctrl'), plus, key('C'), then, key('Ctrl'), plus, key('V')],
    ]);
  });

  it('клавиши через пробел без «+» — соседние блоки без соединителя', () => {
    expect(hotkeyAlternatives('↑ ↓ ← →')).toEqual([[key('↑'), key('↓'), key('←'), key('→')]]);
  });

  it('каждая строка карты разбирается без пустых блоков и без потери клавиш', () => {
    for (const group of HOTKEYS_MAP) {
      for (const entry of group.entries) {
        const tokens = hotkeyAlternatives(entry.keys).flat();
        expect(tokens.length).toBeGreaterThan(0);
        for (const token of tokens) {
          if (token.kind === 'key') expect(token.label.trim()).toBe(token.label);
          if (token.kind === 'key') expect(token.label).not.toBe('');
        }
        const labels = tokens.flatMap((token) => (token.kind === 'key' ? [token.label] : []));
        // Every non-separator word of the source survives as a key block.
        const words = entry.keys
          .split(/\s+или\s+|\s+\/\s+|\s+затем\s+|\s*\+\s*|\s+/)
          .filter((word) => word !== '');
        expect(labels).toEqual(words);
      }
    }
  });
});
