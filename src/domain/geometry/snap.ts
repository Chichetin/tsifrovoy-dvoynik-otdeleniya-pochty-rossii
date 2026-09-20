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
 * kept as the guide has it: a wall face at 14,875 rounded to the centimetre is
 * 14,88 — five millimetres inside the wall, and the check that was meant to be
 * satisfied fires instead. Everything else is stored to the centimetre, as a
 * hand-placed value is.
 */
export function settle(value: number, snap: AxisSnap | null): number {
  // A guide keeps its own digits (a face at x ± 0,0625 included); only the
  // float noise of `centre + delta` is removed, far below any tolerance.
  const units = snap?.kind === 'guide' ? 1e9 : 100;
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
 * Below this many pixels apart the snapping grid reads as a grey fill rather
 * than as a grid, and stops helping: it is not drawn at all instead.
 */
export const ROOM_GRID_MIN_PX = 7;

/**
 * Coordinates of the snapping step inside a room (D-230), in metres.
 *
 * The canvas already has a background grid whose step follows the zoom and says
 * how big the plan is. This one is the other question — where a point will
 * land — so its step is always the snapping step, and it exists only where
 * snapping to it does: inside the room.
 *
 * Returned as bare coordinates over the room's extent. Cutting them to the
 * outline is the caller's job: a room may be L-shaped, and clipping to a
 * polygon is what a canvas does in one operation and arithmetic does badly.
 */
export function roomGridCoordinates(
  boundary: readonly (readonly [number, number])[],
  step_m: number,
  scale: number,
): { xs: number[]; ys: number[] } | null {
  if (boundary.length < 3) return null;
  // Нулевой, отрицательный шаг и нулевой масштаб отсекает этот же порог:
  // отдельной проверки для них нет, потому что она никогда не срабатывает.
  if (!(step_m * scale >= ROOM_GRID_MIN_PX)) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of boundary) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const xs: number[] = [];
  for (let x = Math.ceil(minX / step_m) * step_m; x <= maxX; x += step_m) xs.push(x);
  const ys: number[] = [];
  for (let y = Math.ceil(minY / step_m) * step_m; y <= maxY; y += step_m) ys.push(y);

  return { xs, ys };
}

/**
 * What a guide coordinate is on the plan (D-224). A guide is a bare number, and
 * a number cannot answer the one question the person drawing has: «к чему
 * прилипнет точка». The layer that draws the marker needs the answer before the
 * click, not the file after it.
 */
export type GuideSource = 'wall' | 'room' | 'zone';

/** The same, plus the fallback every axis has when no guide is near. */
export type SnapTarget = GuideSource | 'grid';

/** Guide coordinates with what each of them belongs to, per axis. */
export type GuideSources = {
  xs: ReadonlyMap<number, GuideSource>;
  ys: ReadonlyMap<number, GuideSource>;
};

/** Guides that can name themselves; `xs`/`ys` stay the plain arithmetic input. */
export type LabelledGuides = SnapGuides & { sources: GuideSources };

export type AxisHint = AxisSnap & { target: SnapTarget };

/** Where the next click would land and what each coordinate would catch. */
export type SnapHint = { point: [number, number]; x: AxisHint | null; y: AxisHint | null };

/**
 * Which description wins when one coordinate is several things at once — a zone
 * drawn flush to a wall shares that wall's face, and a room's corner is the end
 * of two walls. The wall is the physical thing the eye aims at, and the room's
 * outline is more definite than one of the many zones drawn on it.
 */
const SOURCE_RANK: Record<GuideSource, number> = { wall: 0, room: 1, zone: 2 };

export function strongerSource(known: GuideSource | undefined, found: GuideSource): GuideSource {
  return known !== undefined && SOURCE_RANK[known] <= SOURCE_RANK[found] ? known : found;
}

/**
 * The same landing point `snapPoint` gives, plus what each axis caught — the
 * marker under the cursor and the click that follows it must never disagree, so
 * both come from here (D-224). Each axis answers on its own: x may sit on a
 * wall's face while y goes to a grid node, and showing that honestly is the
 * whole point (D-209 pulls the coordinates independently).
 *
 * `Alt` is the caller's business: with snapping off there is no target, so no
 * hint is asked for.
 */
export function snapHint(
  point: readonly [number, number],
  guides: LabelledGuides,
  step: number | null,
  tolerance: number,
): SnapHint {
  const snap = snapPoint(point, guides, step, tolerance);
  return {
    point: settlePoint(snap),
    x: axisHint(snap.x, guides.sources.xs),
    y: axisHint(snap.y, guides.sources.ys),
  };
}

function axisHint(snap: AxisSnap | null, sources: ReadonlyMap<number, GuideSource>): AxisHint | null {
  if (snap === null) return null;
  if (snap.kind === 'grid') return { ...snap, target: 'grid' };
  const source = sources.get(snap.value);
  // A guide nobody can name is not shown: the marker either says what the point
  // will catch or says nothing. The coordinate still snaps — silence here costs
  // the hint, never the geometry.
  return source === undefined ? null : { ...snap, target: source };
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
