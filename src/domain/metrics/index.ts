/**
 * G03: how much floor there is, and how much of it is taken.
 *
 * Everything here is geometry, never bookkeeping. Occupied floor is the *union*
 * of footprints clipped to the outline being measured, so two overlapping racks
 * take the space of their union, not of their sum — the plan's own error must
 * not inflate the occupied area and shrink the free one twice over.
 *
 * Zone membership plays no part. A bench standing inside a waiting area that is
 * itself inside the client area occupies floor in both, because it physically
 * does; asking `zoneId` instead would make the answer depend on a link that the
 * user can be in the middle of fixing.
 *
 * That is also why zone areas must never be added up: nested zones overlap by
 * design, and their sum exceeds the room — the very arithmetic that makes the
 * organizers' example claim 96.75 m² of zones inside a 78 m² branch.
 */

import * as polyclip from 'polyclip-ts';
import type {
  AreaMetrics,
  Catalog,
  Equipment,
  Id,
  Issue,
  Metrics,
  PlanDocument,
  Point,
  Polygon,
  Result,
} from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { findObjectType } from '../catalog';
import { boundingBox, boxesOverlap, contains, footprint, isSimplePolygon, polygonArea } from '../geometry';
import type { BoundingBox } from '../geometry';

/** Codes owned by this module. */
export const METRICS_ISSUE_CODES = {
  /** A polygon self-intersects, so no area can be derived from it. */
  AREA_UNCOMPUTABLE: 'AREA_UNCOMPUTABLE',
} as const;

/**
 * What polyclip returns: a list of polygons, each an outer ring followed by its
 * holes. The library exports only `Geom`, so the result shape is named here.
 */
type Clipped = [number, number][][][];

/** polyclip needs closed rings; our model stores them open. */
function closed(polygon: Polygon): [number, number][] {
  const first = polygon[0];
  if (first === undefined) return [];
  return [...polygon.map((point) => [point[0], point[1]] as [number, number]), [first[0], first[1]]];
}

function asGeometry(polygon: Polygon): polyclip.Geom {
  return [[closed(polygon)]];
}

/** Area of a multipolygon: outer rings add, holes subtract. */
function geometryArea(geometry: Clipped): number {
  let total = 0;
  for (const polygon of geometry) {
    polygon.forEach((ring, index) => {
      const open: Point[] = ring.slice(0, -1).map((point) => [point[0], point[1]]);
      if (open.length < 3) return;
      const area = polygonArea(open);
      // Первое кольцо — внешнее, остальные — дырки: двор внутри кольца
      // стеллажей полом не занят.
      total += index === 0 ? area : -area;
    });
  }
  return total;
}

function intersect(
  left: Clipped,
  right: Polygon,
): Clipped {
  if (left.length === 0) return [];
  return polyclip.intersection(left as polyclip.Geom, asGeometry(right));
}

/** One polygon of the occupied floor with its box, so a zone can skip what is nowhere near it. */
type Occupied = { polygon: Clipped[number]; box: BoundingBox; outer: Polygon; solid: boolean };

function occupiedPieces(geometry: Clipped): Occupied[] {
  return geometry.flatMap((polygon) => {
    const outer: Polygon = (polygon[0] ?? []).slice(0, -1).map((point) => [point[0], point[1]]);
    if (outer.length < 3) return [];
    return [{ polygon, box: boundingBox(outer), outer, solid: polygon.length === 1 }];
  });
}

/**
 * Area of the occupied floor inside an outline. Clipping is exact but costly
 * (arbitrary precision, every edge of every object), and on a large plan most
 * objects are nowhere near the zone being measured: pieces whose box misses the
 * outline's box contribute nothing, pieces that lie wholly inside it (and have
 * no courtyard) contribute their own area. Only the pieces that straddle the
 * outline are clipped — the answer is the same within TOLERANCE (a box or a
 * containment test treats a sliver thinner than the tolerance as contact), the
 * work is local (D-205).
 */
function occupiedWithin(pieces: Occupied[], outline: Polygon): number {
  const box = boundingBox(outline);
  let total = 0;
  const straddling: Clipped = [];
  for (const piece of pieces) {
    if (!boxesOverlap(piece.box, box)) continue;
    if (piece.solid && contains(outline, piece.outer)) {
      total += polygonArea(piece.outer);
      continue;
    }
    straddling.push(piece.polygon);
  }
  return total + geometryArea(intersect(straddling, outline));
}

/** Objects the catalog says stand on the floor. Unknown types count as solid. */
function floorObjects(catalog: Catalog, objects: Equipment[]): Equipment[] {
  return objects.filter(
    (object) => findObjectType(catalog, object.typeId)?.occupiesFloor ?? true,
  );
}

function unionOfFootprints(objects: Equipment[]): Clipped {
  if (objects.length === 0) return [];
  const [first, ...rest] = objects;
  if (first === undefined) return [];
  return polyclip.union(
    asGeometry(footprint(first)),
    ...rest.map((object) => asGeometry(footprint(object))),
  );
}

/**
 * Floor outside the branch is not floor: a zone drawn past a wall counts only
 * the part inside the room, and so does the equipment standing on it.
 */
function metricsOf(
  outline: Polygon,
  room: Polygon,
  occupiedEverywhere: Occupied[],
): AreaMetrics {
  const inside = polyclip.intersection(asGeometry(outline), asGeometry(room));
  const total = geometryArea(inside);
  const occupied = occupiedWithin(occupiedEverywhere, outline);
  const free = total - occupied;
  return {
    total_m2: total,
    occupied_m2: occupied,
    // Clamp only the tolerance-sized negative that floating point leaves behind;
    // anything larger means the plan is broken and must not be hidden here.
    free_m2: free < 0 && free > -TOLERANCE.area_m2 ? 0 : free,
  };
}

function uncomputable(message: string, refs: Issue['refs'], polygon: Polygon): Issue {
  return {
    code: METRICS_ISSUE_CODES.AREA_UNCOMPUTABLE,
    severity: 'error',
    message,
    refs,
    polygon,
  };
}

/**
 * Areas of the room and of every zone. Fails rather than guesses: a polygon
 * that crosses itself has no area, and a number invented here would travel
 * straight into the assistant's explanation.
 */
export function measurePlan(plan: PlanDocument): Result<Metrics> {
  const issues: Issue[] = [];
  if (!isSimplePolygon(plan.room.boundary)) {
    issues.push(
      uncomputable(
        'Контур помещения пересекает сам себя: площадь по нему не считается.',
        [{ kind: 'room', id: plan.room.id }],
        plan.room.boundary,
      ),
    );
  }
  for (const zone of plan.zones) {
    if (isSimplePolygon(zone.polygon)) continue;
    issues.push(
      uncomputable(
        `Контур зоны «${zone.name}» пересекает сам себя: площадь по нему не считается.`,
        [{ kind: 'zone', id: zone.id }],
        zone.polygon,
      ),
    );
  }
  if (issues.length > 0) return { ok: false, issues };

  // Footprints are unioned once and clipped to the room: an object sticking out
  // of the branch takes only the floor that is actually inside it.
  const occupied = occupiedPieces(
    intersect(unionOfFootprints(floorObjects(plan.catalog, plan.objects)), plan.room.boundary),
  );

  const zones: Record<Id, AreaMetrics> = {};
  for (const zone of plan.zones) {
    zones[zone.id] = metricsOf(zone.polygon, plan.room.boundary, occupied);
  }

  return {
    ok: true,
    value: { room: metricsOf(plan.room.boundary, plan.room.boundary, occupied), zones },
  };
}
