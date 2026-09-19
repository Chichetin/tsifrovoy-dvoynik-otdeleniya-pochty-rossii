/**
 * U05-ux: labels of informational layers never cover each other.
 *
 * Two layers on at once — load and staff — put two numbers into the middle of
 * the same zone, and a parent zone's middle often falls on a child's. Labels
 * are placed greedily in request order: a label that would overlap something
 * already placed (or a fixed obstacle: zone name, legend) moves down one step
 * at a time until it is free. Screen pixels, y down.
 */

export type Box = { x: number; y: number; width: number; height: number };

/** Strict overlap: boxes that only touch along an edge do not overlap. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Width of a one-line label before Konva measures it. Generous on purpose:
 * a too wide box only costs a little space, a too narrow one lets text overlap.
 */
export function labelWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.62) + 8;
}

const STEP = 2;
const MAX_STEPS = 400;

/**
 * `gap` keeps placed boxes that far apart: a stroked label is drawn half a
 * stroke wider than its box, so touching boxes would still touch on screen.
 */
export function placeLabels(obstacles: Box[], requests: Box[], gap = 0): Box[] {
  const taken: Box[] = [...obstacles];
  const grown = (box: Box): Box => ({
    x: box.x - gap,
    y: box.y - gap,
    width: box.width + 2 * gap,
    height: box.height + 2 * gap,
  });
  return requests.map((request) => {
    let box = request;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const hit = taken.find((other) => boxesOverlap(grown(box), other));
      if (hit === undefined) break;
      // Jump straight below the obstacle: fewer steps, same result as crawling.
      box = { ...box, y: Math.max(box.y + STEP, hit.y + hit.height + gap) };
    }
    taken.push(box);
    return box;
  });
}
