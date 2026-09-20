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

export type PointSnap = { point: [number, number]; x: AxisSnap | null; y: AxisSnap | null };

/**
 * What gets stored after a snap (D-211). A coordinate that came from a guide is
 * kept as the guide has it (to the millimetre): a wall face at 14,875 rounded
 * to the centimetre is 14,88 — five millimetres inside the wall, and the check
 * that was meant to be satisfied fires instead. Everything else is stored to
 * the centimetre, as a hand-placed value is.
 */
export function settle(value: number, snap: AxisSnap | null): number {
  const units = snap?.kind === 'guide' ? 1000 : 100;
  return Math.round(value * units) / units;
}

export function settlePoint(snap: PointSnap): [number, number] {
  return [settle(snap.point[0], snap.x), settle(snap.point[1], snap.y)];
}

/**
 * Where a clicked or dragged vertex lands: each coordinate goes to the nearest
 * guide within tolerance, else to the grid. A vertex is a single value per
 * axis, so unlike a box it may take the grid at full tolerance — that is what
 * turns a hand-drawn 9.87 × 8.13 room into 10 × 8.
 */
export function snapPoint(
  point: readonly [number, number],
  guides: SnapGuides,
  step: number | null,
  tolerance: number,
): PointSnap {
  const x = snapAxis(point[0], guides.xs, step, tolerance);
  const y = snapAxis(point[1], guides.ys, step, tolerance);
  return { point: [x?.value ?? point[0], y?.value ?? point[1]], x, y };
}

/**
 * How far to shift a box so that one of its sides lands on a target. People
 * align furniture by its edges, so the centre is offered to guides only (a
 * neighbour's axis, a wall's face) and never to the grid; and the grid pulls
 * from half the distance — otherwise a 1.2 m rack on a 0.5 m grid would be
 * within reach of some node at every position and never move freely. Each
 * axis snaps on its own — a box can meet a wall in x and a grid line in y.
 */
export function snapBox(
  box: BoundingBox,
  guides: SnapGuides,
  step: number | null,
  tolerance: number,
): BoxSnap {
  const x = snapEdges([box.minX, box.maxX], (box.minX + box.maxX) / 2, guides.xs, step, tolerance);
  const y = snapEdges([box.minY, box.maxY], (box.minY + box.maxY) / 2, guides.ys, step, tolerance);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, x, y };
}

function snapEdges(
  edges: readonly number[],
  centre: number,
  guides: readonly number[],
  step: number | null,
  tolerance: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  const candidates: [number, number | null, number][] = [
    ...edges.map((edge): [number, number | null, number] => [edge, step, tolerance / 2]),
    [centre, null, tolerance],
  ];
  for (const [edge, gridStep, gridTolerance] of candidates) {
    const found = snapAxis(edge, guides, null, tolerance) ?? snapAxis(edge, [], gridStep, gridTolerance);
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
