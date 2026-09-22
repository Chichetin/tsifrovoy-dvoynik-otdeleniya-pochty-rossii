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
import { boundingBox, footprint, modelToScreen } from '../../domain/geometry';

export type ObjectLabel = {
  text: string;
  /** Screen centre of the object, in pixels. */
  x: number;
  y: number;
  /** Width of the text box, in pixels: a little wider than the footprint is on screen. */
  width: number;
  fontSize: number;
  /** One line with an ellipsis, or two wrapped lines when the footprint is tall enough. */
  lines: 1 | 2;
  /**
   * Поворот подписи в градусах, вокруг центра объекта. 0 — обычный случай,
   * текст горизонтален. Ненулевой означает, что объект стоит «на торце»
   * (повёрнутый стол, стеллаж вдоль стены): поперёк он узкий, и подпись
   * пускается вдоль длинной стороны. Всегда в (-90, 90] — вверх ногами
   * текст не читается.
   */
  rotation: number;
};

/** Below this many pixels of screen width the caption is dropped, not squeezed. */
export const LABEL_MIN_WIDTH_PX = 44;
export const LABEL_FONT_PX = 11;
export const LABEL_LINE_PX = 13;
/** The box may hang over the footprint a little: «Окно 1 — приём» beats «Окно 1 —…». */
const LABEL_OVERHANG = 1.3;

/**
 * Приводит угол в (-90, 90]: текст под 100° — это тот же текст под -80°, но
 * читаемый. Ровно 90° оставляем (подпись снизу вверх — привычная для планов),
 * а -90° переводим в 90°, чтобы у двух одинаковых стеллажей, повёрнутых в
 * разные стороны, подписи шли одинаково.
 */
function readableAngle(degrees: number): number {
  let angle = degrees % 180;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return angle;
}

export function objectLabel(object: Equipment, viewport: Viewport): ObjectLabel | null {
  const text = planDisplayLabel(object);
  if (text === '') return null;
  const [x, y] = modelToScreen(object.position, viewport);

  // Сначала — как объект лежит на экране. Для неповёрнутого объекта это его
  // собственные габариты, и подпись идёт горизонтально: так её читать легче
  // всего, и менять это поведение не из-за чего.
  const box = boundingBox(footprint(object));
  const width = (box.maxX - box.minX) * viewport.scale;
  const height = (box.maxY - box.minY) * viewport.scale;
  if (width >= LABEL_MIN_WIDTH_PX && height >= LABEL_FONT_PX + 2) {
    const lines: 1 | 2 = height >= LABEL_LINE_PX * 2 + 4 ? 2 : 1;
    return {
      text,
      x,
      y,
      width: Math.round(width * LABEL_OVERHANG),
      fontSize: LABEL_FONT_PX,
      lines,
      rotation: 0,
    };
  }

  // Поперёк объект узкий — горизонтальной подписи не хватает места. Раньше
  // подпись здесь просто исчезала, и повёрнутый стол становился безымянным
  // прямоугольником: на плане, повёрнутом вдоль стены, так пропадал целый
  // ряд рабочих мест. Вдоль объекта место есть — пускаем подпись вдоль.
  const along = object.size_m[0] * viewport.scale;
  const across = object.size_m[1] * viewport.scale;
  const long = Math.max(along, across);
  const short = Math.min(along, across);
  if (long < LABEL_MIN_WIDTH_PX || short < LABEL_FONT_PX + 2) return null;

  // Длинная сторона — либо собственный X объекта, либо его Y, повёрнутый на
  // прямой угол; сам объект нарисован под `rotation_deg` (`EquipmentLayer`).
  const rotation = readableAngle(object.rotation_deg + (along >= across ? 0 : 90));
  const lines: 1 | 2 = short >= LABEL_LINE_PX * 2 + 4 ? 2 : 1;
  return {
    text,
    x,
    y,
    width: Math.round(long * LABEL_OVERHANG),
    fontSize: LABEL_FONT_PX,
    lines,
    rotation,
  };
}

/** Keep the workstation number visible on dense plans; the full name remains
 * in the document, hover summary and properties card. */
export function planDisplayLabel(object: Pick<Equipment, 'typeId' | 'label'>): string {
  const full = object.label.trim();
  if (object.typeId === 'ot_workplace') {
    return full.replace(/^Рабочее место оператора(\s+\d+)$/u, 'Рабочее место$1');
  }
  return full;
}
