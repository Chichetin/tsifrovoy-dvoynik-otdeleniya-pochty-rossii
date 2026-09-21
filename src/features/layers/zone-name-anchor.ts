/**
 * Where a zone's name sits on the plan — duplicated from `zoneLabelAnchor`
 * (`src/features/plan-tools/zone-label.ts`, D-216) for `InformationLayer`'s
 * own obstacle map (D-241, UI-4).
 *
 * `InformationLayer` needs the *real* on-screen position of a zone's name to
 * keep its own labels ("45 %" and the like) off it. `src/features/layers`
 * cannot import `src/features/plan-tools` — features do not import siblings
 * (`eslint.config.js`, `docs/project-structure.md`) — and `InformationLayerProps`
 * (`src/contracts/ui.ts`) is frozen for this change: piping the anchor through
 * as a prop is a contract edit, out of scope here. Moving the function to a
 * shared, feature-agnostic place (e.g. `src/domain`) would have been the
 * clean fix, but `zone-label.ts` lives under `plan-tools`, which has an open
 * MR at the time of this change — moving it is not available either.
 *
 * So this is a deliberate, acknowledged copy of the pure rule, not a
 * reimplementation from memory: same constants, same algorithm, same
 * comments where they still apply. It has no feature-specific dependency —
 * only `domain/geometry` and `contracts/model`, both already shared — so the
 * duplication is the algorithm's *text*, not a design fork. A change to the
 * real rule that is not mirrored here is caught by
 * `сравнение с zoneLabelAnchor (D-216)` in `tests/e2e/layers.spec.ts`, which
 * imports both `zoneLabelAnchor` and `zoneNameAnchor` and asserts they agree
 * on every zone of every demo plan; that spec file sits outside `src/features`,
 * so it is free to import both. If the two ever need to diverge on purpose,
 * that test is the place to say why.
 */

import type { Point, Polygon } from '../../contracts/model';
import { type BoundingBox, boundingBox } from '../../domain/geometry';

/** Mirrors `RESERVED_WIDTH_M` in `zone-label.ts`. */
const RESERVED_WIDTH_M = 3;
const RESERVED_HEIGHT_M = 0.5;
const HALF_HEIGHT_M = RESERVED_HEIGHT_M / 2;
const GAP_M = 0.12;
const EDGE_CLEARANCE_M = 0.2;

type Interval = { min: number; max: number };

function mergeIntervals(ranges: Interval[]): Interval[] {
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  const merged: Interval[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.min <= last.max) {
      last.max = Math.max(last.max, range.max);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Same signature and behaviour as `zoneLabelAnchor` — see its doc comment for the rule itself. */
export function zoneNameAnchor(polygon: Polygon, objectBoxes: readonly BoundingBox[]): Point {
  const box = boundingBox(polygon);
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;

  const reservedMinX = centreX - RESERVED_WIDTH_M / 2;
  const reservedMaxX = centreX + RESERVED_WIDTH_M / 2;
  const forbidden = mergeIntervals(
    objectBoxes
      .filter((object) => object.minX < reservedMaxX && reservedMinX < object.maxX)
      .map((object) => ({
        min: object.minY - GAP_M - HALF_HEIGHT_M,
        max: object.maxY + GAP_M + HALF_HEIGHT_M,
      })),
  );

  const blocking = forbidden.find((range) => centreY >= range.min && centreY <= range.max);
  if (blocking === undefined) return [centreX, centreY];

  const tightLow = Math.min(box.minY + HALF_HEIGHT_M, box.maxY - HALF_HEIGHT_M);
  const tightHigh = Math.max(box.minY + HALF_HEIGHT_M, box.maxY - HALF_HEIGHT_M);
  const wideLow = box.minY + HALF_HEIGHT_M + EDGE_CLEARANCE_M;
  const wideHigh = box.maxY - HALF_HEIGHT_M - EDGE_CLEARANCE_M;
  const low = wideLow <= wideHigh ? wideLow : tightLow;
  const high = wideLow <= wideHigh ? wideHigh : tightHigh;
  const aboveFits = blocking.max <= high;
  const belowFits = blocking.min >= low;

  let y: number;
  if (aboveFits && belowFits) {
    y = Math.abs(blocking.max - centreY) <= Math.abs(blocking.min - centreY) ? blocking.max : blocking.min;
  } else if (aboveFits) {
    y = blocking.max;
  } else if (belowFits) {
    y = blocking.min;
  } else {
    y = centreY - low <= high - centreY ? high : low;
  }
  return [centreX, Math.min(Math.max(y, low), high)];
}
