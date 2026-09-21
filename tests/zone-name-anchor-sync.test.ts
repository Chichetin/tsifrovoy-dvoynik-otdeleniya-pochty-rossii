/**
 * D-231 sentinel: catches divergence between the real zone-name rule
 * (`zoneLabelAnchor`, D-216, `src/features/plan-tools/zone-label.ts`) and
 * `InformationLayer`'s intentional copy of it (`zoneNameAnchor`,
 * `src/features/layers/zone-name-anchor.ts`). Lives directly under `tests/`,
 * not `src/features/**` or `tests/e2e/`: `eslint.config.js` forbids a
 * feature importing a sibling feature, so this is the only place both may
 * be imported together, and it is pure computation — `vitest.config.ts`
 * picks up `tests/**\/*.test.{ts,tsx}` into plain `npm test`, so a future
 * edit to one copy without the other is caught at the author's desk in a
 * few hundred milliseconds, not ten minutes later in a full `test:e2e` run.
 *
 * Real demo plans alone do not exercise the boundary branches: on
 * `demo/before.json` and `demo/after.json` no zone/object geometry lands
 * exactly on `mergeIntervals`' touching-interval test, the inclusive
 * blocking check, the tie-break, or the edge clamp. The synthetic cases
 * below (reusing the boundary fixtures from `zone-name-anchor.test.ts` /
 * `zone-label.test.ts`) land exactly on two of those four: rewriting
 * `mergeIntervals`' `<=` to `<`, or the tie-break's `<=` to `<`, in only one
 * of the two copies now fails a case here.
 *
 * The other two boundary rewrites named in review — the blocking check's
 * `>=`/`<=` turned strict, and dropping the final clamp — stay uncaught on
 * purpose: applied to only one copy, both are equivalent mutations, not a
 * gap. Whenever `centreY` sits exactly on the forbidden interval's edge, the
 * tie-break's zero-distance side always wins (`Math.abs(0) <= Math.abs(x)`
 * is true for any `x`), so the escape point equals that edge — the same
 * value `centreY` itself already was. Strict vs inclusive changes only
 * whether the algorithm calls that point "blocked"; the point it returns is
 * identical either way. The clamp is redundant by the same token: `low` and
 * `high` are built as `centreY ± offset` (tight fallback) or bracket it by
 * construction (wide case), so `centreY ∈ [low, high]` always, and every
 * branch's pre-clamp `y` is provably inside that range too (`aboveFits`
 * already implies `y = blocking.max ≤ high`, and `blocking.max ≥ centreY ≥
 * low`; the symmetric argument covers `belowFits`). No input — synthetic or
 * real — can make these two mutations observable from the anchor's output.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { PlanDocument, Polygon } from '../src/contracts/model';
import { parsePlanDocument } from '../src/contracts/schema';
import { type BoundingBox, boundingBox, footprint } from '../src/domain/geometry';
import { zoneNameAnchor } from '../src/features/layers/zone-name-anchor';
import { zoneLabelAnchor } from '../src/features/plan-tools/zone-label';

function demo(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(`${path} не разобрался`);
  return parsed.value;
}

function objectBoxesOf(plan: PlanDocument): BoundingBox[] {
  const visibleLayers = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return plan.objects
    .filter((object) => visibleLayers.has(object.layerId))
    .map((object) => boundingBox(footprint(object)));
}

const square: Polygon = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
];

describe('якорь имени зоны: копия в InformationLayer не расходится с оригиналом (D-216/D-231)', () => {
  for (const path of ['demo/before.json', 'demo/after.json']) {
    test(`совпадает с zoneLabelAnchor на ${path}`, () => {
      const plan = demo(path);
      const objectBoxes = objectBoxesOf(plan);
      for (const zone of plan.zones) {
        expect(zoneNameAnchor(zone.polygon, objectBoxes)).toEqual(zoneLabelAnchor(zone.polygon, objectBoxes));
      }
    });
  }

  test('объект перекрывает центр ровно на границе резерва — inclusive blocking check совпадает', () => {
    const atCentre: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 4 };
    expect(zoneNameAnchor(square, [atCentre])).toEqual(zoneLabelAnchor(square, [atCentre]));
  });

  test('два объекта впритык (без зазора) — mergeIntervals совпадает на касающейся границе', () => {
    const rackOne: BoundingBox = { minX: 2, maxX: 4, minY: 2, maxY: 2.68 };
    const touching = 2.68 + 0.12 + 0.25; // rackTwo.minY - GAP_M - HALF_HEIGHT_M касается rackOne
    const rackTwo: BoundingBox = { minX: 2, maxX: 4, minY: touching + 0.12 + 0.25, maxY: 4 };
    expect(zoneNameAnchor(square, [rackOne, rackTwo])).toEqual(zoneLabelAnchor(square, [rackOne, rackTwo]));
  });

  test('зона забита объектами без свободной строки — клэмп к краю совпадает', () => {
    const blockers: BoundingBox[] = [
      { minX: 2, maxX: 4, minY: 0, maxY: 1.8 },
      { minX: 2, maxX: 4, minY: 2, maxY: 3.8 },
      { minX: 2, maxX: 4, minY: 4, maxY: 6 },
    ];
    expect(zoneNameAnchor(square, blockers)).toEqual(zoneLabelAnchor(square, blockers));
  });

  test('мелкая полоса вдоль стены — выбор между узким и широким запасом (tie-break/clamp) совпадает', () => {
    const strip: Polygon = [
      [0, 0],
      [4, 0],
      [4, 0.5],
      [0, 0.5],
    ];
    const atCentre: BoundingBox = { minX: 1, maxX: 3, minY: 0, maxY: 0.5 };
    expect(zoneNameAnchor(strip, [atCentre])).toEqual(zoneLabelAnchor(strip, [atCentre]));
  });
});
