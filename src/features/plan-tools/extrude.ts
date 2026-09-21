/**
 * Кадр жеста «вытянуть выступ из ребра» (D-232).
 *
 * Тот же приём, что у `notice.ts` и `snap-marker.ts` рядом: модульная
 * переменная, а не состояние React. Вытягиваемая вершина живёт ровно столько,
 * сколько длится протяжка, и рисует её `editing` в слое — перерисовывать
 * что-либо из-за самой записи не нужно, а `useRef` в этом месте запрещён
 * правилом «никаких ref во время отрисовки».
 *
 * В документ, историю и сохранённый файл отсюда не попадает ничего.
 */

import type { Polygon, Ref } from '../../contracts/model';

/** Какое кольцо тянут, какая вершина в нём новая и от чего её считать. */
export type Extrusion = { ref: Ref; index: number; base: Polygon };

let pulled: Extrusion | null = null;

export function startExtrusion(extrusion: Extrusion): void {
  pulled = extrusion;
}

export function currentExtrusion(): Extrusion | null {
  return pulled;
}

/** Снимает жест и отдаёт то, что он тянул: конец протяжки и отмена — одно и то же. */
export function endExtrusion(): Extrusion | null {
  const done = pulled;
  pulled = null;
  return done;
}
