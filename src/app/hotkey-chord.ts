/**
 * Splits a hotkey line from `HOTKEYS_MAP` («Ctrl+Shift+Z или Ctrl+Y») into
 * key blocks for the hotkeys dialog, so every key is drawn as its own <kbd>.
 *
 * Formats present in the map: single key («F», «?»), chord with «+» with or
 * without spaces («Shift+R», «Shift + стрелка»), alternatives via «или» or
 * « / », a sequence via «затем» («Ctrl+C затем Ctrl+V») and bare keys
 * separated by spaces («↑ ↓ ← →» — adjacent blocks, no connector).
 */

export type HotkeyToken = { kind: 'key'; label: string } | { kind: 'plus' } | { kind: 'then' };

/** One alternative — tokens rendered side by side; alternatives are joined by «или». */
export type HotkeyAlternative = readonly HotkeyToken[];

const ALTERNATIVE_SEPARATOR = /\s+или\s+|\s+\/\s+/;
const SEQUENCE_SEPARATOR = /\s+затем\s+/;
const CHORD_SEPARATOR = /\s*\+\s*/;

function chordTokens(chord: string): HotkeyToken[] {
  const tokens: HotkeyToken[] = [];
  const keys = chord.split(CHORD_SEPARATOR).filter((part) => part !== '');
  keys.forEach((part, index) => {
    if (index > 0) tokens.push({ kind: 'plus' });
    // Space inside a chord part means several independent keys («↑ ↓ ← →»).
    for (const label of part.split(/\s+/).filter((word) => word !== '')) tokens.push({ kind: 'key', label });
  });
  return tokens;
}

export function hotkeyAlternatives(keys: string): HotkeyAlternative[] {
  return keys
    .trim()
    .split(ALTERNATIVE_SEPARATOR)
    .map((alternative) => {
      const tokens: HotkeyToken[] = [];
      alternative.split(SEQUENCE_SEPARATOR).forEach((step, index) => {
        if (index > 0) tokens.push({ kind: 'then' });
        tokens.push(...chordTokens(step));
      });
      return tokens;
    })
    .filter((alternative) => alternative.length > 0);
}
