/**
 * Snapping (D-208): where a dragged thing lands when it is close to something
 * worth aligning with. Pure arithmetic in world metres; the layer converts its
 * pixel tolerance through the viewport scale and decides when snapping is off
 * (`Alt` during the gesture).
 *
 * Two kinds of targets, in order of preference: guides — coordinates of edges
 * and vertices already on the plan (room outline, walls, neighbours' boxes) —
 * and the grid. A guide within tolerance beats the grid: a rack that ends
 * exactly where the next rack starts matters more than a round number.
 * Plan-aware helpers (`objectGuides`, `snapObjectCentre`) live in `index.ts`
 * next to `footprint`.
 */

import type { BoundingBox } from './polygons';

/**
 * The one snapping policy of the editor: grid nodes every half metre (the
 * step of the plan grid in the package spec) and a reach of a few pixels, so
 * the pull feels the same at every zoom. Layers divide `tolerance_px` by the
 * viewport scale to get metres.
 */
export const SNAP = { grid_m: 0.5, tolerance_px: 8 } as const;

/** Coordinates of vertical (`xs`) and horizontal (`ys`) lines to align with. */
export type SnapGuides = { xs: number[]; ys: number[] };

export type SnapKind = 'guide' | 'grid';

export type AxisSnap = { value: number; delta: number; kind: SnapKind };

/**
 * The nearest target for one coordinate within `tolerance`, or null. Guides
 * win over the grid when both are within reach, even if the grid is closer.
 */
export function snapAxis(
  value: number,
  guides: readonly number[],
  step: number | null,
  tolerance: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const guide of guides) {
    const delta = guide - value;
    if (Math.abs(delta) > tolerance) continue;
    if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
      best = { value: guide, delta, kind: 'guide' };
    }
  }
  if (best !== null) return best;
  if (step === null || step <= 0) return null;
  const node = Math.round(value / step) * step;
  const delta = node - value;
  return Math.abs(delta) <= tolerance ? { value: node, delta, kind: 'grid' } : null;
}

export type BoxSnap = { dx: number; dy: number; x: AxisSnap | null; y: AxisSnap | null };

/**
 * How far to shift a box so that one of its sides (or its centre line) lands
 * on a target. Sides are tried first: people align furniture by its edges.
 * Each axis snaps on its own — a box can meet a wall in x and a grid line in y.
 */
export function snapBox(
  box: BoundingBox,
  guides: SnapGuides,
  step: number | null,
  tolerance: number,
): BoxSnap {
  const x = snapEdges([box.minX, box.maxX, (box.minX + box.maxX) / 2], guides.xs, step, tolerance);
  const y = snapEdges([box.minY, box.maxY, (box.minY + box.maxY) / 2], guides.ys, step, tolerance);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, x, y };
}

function snapEdges(
  edges: readonly number[],
  guides: readonly number[],
  step: number | null,
  tolerance: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const edge of edges) {
    const found = snapAxis(edge, guides, step, tolerance);
    if (found === null) continue;
    // A guide anywhere beats the grid anywhere; among equals, the closer one.
    const better =
      best === null ||
      (found.kind === 'guide' && best.kind === 'grid') ||
      (found.kind === best.kind && Math.abs(found.delta) < Math.abs(best.delta));
    if (better) best = found;
  }
  return best;
}
