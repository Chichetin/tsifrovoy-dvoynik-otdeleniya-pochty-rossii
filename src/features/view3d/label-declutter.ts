/**
 * #218: zone names in 3D stand where the 2D plan puts them, but a tilted
 * camera squeezes the floor while a name keeps its height on screen, so the
 * names of neighbouring zones run into each other. This is the screen-space
 * half: boxes in pixels (y down) in, vertical shifts out. Earlier boxes keep
 * their place; a later box moves the least distance up or down that clears
 * every box already placed.
 */

export type LabelBox = { x: number; y: number; width: number; height: number };

/** Space kept between two names, px. */
const LABEL_GAP_PX = 2;

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Vertical shift of each box, px, in input order; the first box never moves. */
export function declutterLabels(boxes: readonly LabelBox[]): number[] {
  const placed: LabelBox[] = [];
  return boxes.map((box) => {
    const candidates = [
      0,
      ...placed.flatMap((other) => [
        other.y - LABEL_GAP_PX - (box.y + box.height),
        other.y + other.height + LABEL_GAP_PX - box.y,
      ]),
    ].sort((a, b) => Math.abs(a) - Math.abs(b));
    const shift = candidates.find((dy) => !placed.some((other) => overlaps({ ...box, y: box.y + dy }, other))) ?? 0;
    placed.push({ ...box, y: box.y + shift });
    return shift;
  });
}
