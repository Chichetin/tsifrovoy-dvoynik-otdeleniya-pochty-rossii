/**
 * D-363: the plate of an object's caption is as wide as its name. A short name
 * gets a short plate, a long one wraps into two lines and gets the width of the
 * longer line — never more than the room the object leaves (`maxWidth`).
 * Text is measured with the same font Konva draws it with.
 */

/** Space between the text and the edge of the plate, each side. */
export const CAPTION_PAD_PX = 6;
const FONT_FAMILY = 'system-ui, sans-serif';

let context: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, fontSize: number): number | null {
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (context === null) return null;
  context.font = `${fontSize}px ${FONT_FAMILY}`;
  return context.measureText(text).width;
}

/** Greedy wrap by words into at most `maxLines`; `null` when it does not fit. */
function wrap(text: string, fontSize: number, room: number, maxLines: number): number | null {
  let widest = 0;
  let lines = 1;
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line === '' ? word : `${line} ${word}`;
    const width = textWidth(next, fontSize);
    if (width === null) return null;
    if (width <= room || line === '') {
      line = next;
      widest = Math.max(widest, width);
      if (width > room) return null;
    } else {
      lines += 1;
      if (lines > maxLines) return null;
      line = word;
      const own = textWidth(word, fontSize);
      if (own === null || own > room) return null;
      widest = Math.max(widest, own);
    }
  }
  return widest;
}

/**
 * Width of the plate (icon space included) and the number of text lines.
 * `maxLines` 1 keeps one line with an ellipsis, as the object is too low for two.
 */
export function fitCaption(
  text: string,
  fontSize: number,
  iconSpace: number,
  maxWidth: number,
  maxLines: 1 | 2,
): { width: number; lines: 1 | 2 } {
  const room = maxWidth - iconSpace - 2 * CAPTION_PAD_PX;
  const whole = textWidth(text, fontSize);
  if (whole === null || room <= 0) return { width: maxWidth, lines: maxLines };
  const frame = (inner: number): number => Math.min(maxWidth, Math.ceil(inner) + 1 + 2 * CAPTION_PAD_PX + iconSpace);
  if (whole <= room) return { width: frame(whole), lines: 1 };
  if (maxLines === 2) {
    const widest = wrap(text, fontSize, room, 2);
    if (widest !== null) return { width: frame(widest), lines: 2 };
  }
  return { width: maxWidth, lines: maxLines };
}
