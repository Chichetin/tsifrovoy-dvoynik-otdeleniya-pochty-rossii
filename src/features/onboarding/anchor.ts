/**
 * UX №2: the on-screen box of a panel the app marked with `data-tour`.
 *
 * The app marks panels it owns directly (`<aside data-tour="side-left">`) or
 * wraps a module's root in a `display: contents` element, which has no box of
 * its own. Such a wrapper is measured by its first child that is actually on
 * screen: the file buttons, not the full-width message line under them.
 */

import type { Box, TourTarget } from './tour';

export const TOUR_ATTRIBUTE = 'data-tour';

export function anchorBox(element: Element): Box | null {
  const view = element.ownerDocument.defaultView;
  if (view?.getComputedStyle(element).display === 'contents') {
    for (const child of Array.from(element.children)) {
      const box = anchorBox(child);
      if (box !== null) return box;
    }
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export type TargetBox = Box & { target: TourTarget };

/** Boxes of the step's panels that are on screen; missing ones are skipped. */
export function targetBoxes(root: ParentNode, targets: readonly TourTarget[]): TargetBox[] {
  const boxes: TargetBox[] = [];
  for (const target of targets) {
    const element = root.querySelector(`[${TOUR_ATTRIBUTE}="${target}"]`);
    const box = element === null ? null : anchorBox(element);
    if (box !== null) boxes.push({ ...box, target });
  }
  return boxes;
}
