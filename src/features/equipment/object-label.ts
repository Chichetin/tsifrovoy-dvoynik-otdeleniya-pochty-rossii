/**
 * Caption of an object on the canvas.
 *
 * The plan is read by a branch manager, not by the person who placed the
 * objects: a green rectangle says nothing until it is clicked. So every object
 * that is wide enough on screen carries its name, centred on the footprint and
 * never rotated — text upside down helps nobody. Small objects (chairs, cash
 * terminals) stay unlabelled until the zoom makes room: a caption wider than
 * its object turns the plan into a word cloud.
 */

import type { Equipment, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';

export type ObjectLabel = {
  text: string;
  /** Screen centre of the object, in pixels. */
  x: number;
  y: number;
  /** Width of the text box, in pixels: a little wider than the footprint's longer side. */
  width: number;
  fontSize: number;
  /** One line with an ellipsis, or two wrapped lines when the footprint is tall enough. */
  lines: 1 | 2;
};

/** Below this many pixels of screen width the caption is dropped, not squeezed. */
export const LABEL_MIN_WIDTH_PX = 44;
export const LABEL_FONT_PX = 11;
export const LABEL_LINE_PX = 13;
/** The box may hang over the footprint a little: «Окно 1 — приём» beats «Окно 1 —…». */
const LABEL_OVERHANG = 1.3;

export function objectLabel(object: Equipment, viewport: Viewport): ObjectLabel | null {
  const text = object.label.trim();
  if (text === '') return null;
  const [w, h] = object.size_m;
  const longer = Math.max(w, h) * viewport.scale;
  const shorter = Math.min(w, h) * viewport.scale;
  if (longer < LABEL_MIN_WIDTH_PX || shorter < LABEL_FONT_PX + 2) return null;
  const [x, y] = modelToScreen(object.position, viewport);
  const lines: 1 | 2 = shorter >= LABEL_LINE_PX * 2 + 4 ? 2 : 1;
  return { text, x, y, width: Math.round(longer * LABEL_OVERHANG), fontSize: LABEL_FONT_PX, lines };
}
