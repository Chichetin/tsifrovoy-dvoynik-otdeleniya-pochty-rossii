/**
 * G02: zone hierarchy and object→zone assignment.
 *
 * An object belongs to the deepest zone that contains its whole footprint.
 * Containment is decided by geometry through its public interface only; this
 * module never reaches into polygon internals.
 */

import type {
  Equipment,
  Id,
  Issue,
  PlanDocument,
  Polygon,
  Ref,
  Result,
  Zone,
  ZoneResolution,
} from '../../contracts/model';
import { CONTRACT_ISSUE_CODES } from '../../contracts/model';
import { boundingBox, boxesOverlap, contains, footprint, isSimplePolygon, polygonArea } from '../geometry';
import type { BoundingBox } from '../geometry';

/** Codes owned by this module, next to its own checks. */
export const RELATION_ISSUE_CODES = {
  /** No zone contains the whole footprint. */
  ZONE_UNASSIGNED: 'ZONE_UNASSIGNED',
  /** A zone polygon cannot be used for containment. */
  ZONE_GEOMETRY_UNUSABLE: 'ZONE_GEOMETRY_UNUSABLE',
} as const;

function issue(code: string, message: string, refs: Ref[], polygon?: Polygon): Issue {
  return polygon === undefined
    ? { code, severity: 'warning', message, refs }
    : { code, severity: 'warning', message, refs, polygon };
}

/** What `parentZoneFor` needs to know about the zones already on the plan. */
export type ZoneShape = Pick<Zone, 'id' | 'polygon' | 'parentId'>;

/**
 * The zone a ring is nested in — one rule for a zone drawn by hand and for a
 * zone read from the organizers' example, which writes no nesting: among the
 * simple zones whose polygon contains the whole ring (and is not the same
 * ring), the deepest in the existing hierarchy wins; equal depth — the
 * smallest by area. A ring crossing a border, lying outside every zone, or
 * coinciding with one stands on its own. `exclude` is the ring's own id when
 * it is already in the list.
 */
export function parentZoneFor(
  ring: Polygon,
  zones: readonly ZoneShape[],
  exclude: Id | null = null,
): Id | null {
  let best: { id: Id; depth: number; area: number } | null = null;
  for (const zone of zones) {
    if (zone.id === exclude) continue;
    if (!isSimplePolygon(zone.polygon) || !contains(zone.polygon, ring)) continue;
    // Equal polygons contain each other: neither is the other's parent.
    if (contains(ring, zone.polygon)) continue;
    const depth = zoneDepth(zone.id, zones) ?? 0;
    const area = polygonArea(zone.polygon);
    if (best === null || depth > best.depth || (depth === best.depth && area < best.area)) {
      best = { id: zone.id, depth, area };
    }
  }
  return best?.id ?? null;
}

/**
 * Nesting depth of a zone, 0 for a root. Returns null when the parent chain
 * does not terminate, so a cycle never turns into an endless walk.
 */
export function zoneDepth(zoneId: Id, zones: readonly ZoneShape[]): number | null {
  const parents = new Map<Id, Id | null>(zones.map((zone) => [zone.id, zone.parentId]));
  const seen = new Set<Id>();
  let current: Id | null = zoneId;
  let depth = 0;
  while (current !== null) {
    if (seen.has(current)) return null;
    seen.add(current);
    const parent: Id | null | undefined = parents.get(current);
    if (parent === undefined || parent === null) return depth;
    current = parent;
    depth += 1;
  }
  return depth;
}

export function hasZoneCycle(zones: Zone[]): boolean {
  return zones.some((zone) => zoneDepth(zone.id, zones) === null);
}

/**
 * What resolving needs to know about the zones, computed once for a whole
 * plan: whether each polygon is usable, its box, its depth. Resolving a
 * thousand objects against fifty zones used to re-check every polygon for
 * self-intersection a hundred thousand times (D-205).
 */
export type PreparedZones = {
  usable: { zone: Zone; box: BoundingBox; depth: number }[];
  unusable: Zone[];
};

export function prepareZones(zones: Zone[]): PreparedZones {
  const usable: PreparedZones['usable'] = [];
  const unusable: Zone[] = [];
  for (const zone of zones) {
    if (isSimplePolygon(zone.polygon)) {
      usable.push({ zone, box: boundingBox(zone.polygon), depth: zoneDepth(zone.id, zones) ?? -1 });
    } else {
      unusable.push(zone);
    }
  }
  return { usable, unusable };
}

/**
 * Assigns an object to the deepest zone containing its whole footprint.
 * Several equally deep candidates leave it unassigned with ZONE_AMBIGUOUS:
 * guessing would silently misplace it in the inventory.
 */
export function resolveZone(
  object: Equipment,
  zones: Zone[],
  prepared: PreparedZones = prepareZones(zones),
): ZoneResolution {
  const ref: Ref = { kind: 'object', id: object.id };
  const shape = footprint(object);
  const box = boundingBox(shape);
  const { unusable } = prepared;

  // One unusable zone makes the whole answer untrustworthy: the object might
  // belong to it once its polygon is fixed. Assigning it to a neighbour would
  // disagree with reconcileZones and put it in the wrong inventory row.
  if (unusable.length > 0) {
    return {
      zoneId: null,
      issues: unusable.map((zone) =>
        issue(
          RELATION_ISSUE_CODES.ZONE_GEOMETRY_UNUSABLE,
          `Геометрия зоны «${zone.id}» не позволяет проверить вложение.`,
          [{ kind: 'zone', id: zone.id }],
        ),
      ),
    };
  }

  const containing = prepared.usable.filter(
    (entry) => boxesOverlap(entry.box, box) && contains(entry.zone.polygon, shape),
  );
  if (containing.length === 0) {
    const issues = [
      issue(
        RELATION_ISSUE_CODES.ZONE_UNASSIGNED,
        `Объект «${object.id}» не лежит целиком ни в одной зоне.`,
        [ref],
        shape,
      ),
    ];
    for (const zone of unusable) {
      issues.push(
        issue(
          RELATION_ISSUE_CODES.ZONE_GEOMETRY_UNUSABLE,
          `Геометрия зоны «${zone.id}» не позволяет проверить вложение.`,
          [{ kind: 'zone', id: zone.id }],
        ),
      );
    }
    return { zoneId: null, issues };
  }

  const maxDepth = Math.max(...containing.map((entry) => entry.depth));
  const deepest = containing.filter((entry) => entry.depth === maxDepth);

  if (deepest.length > 1) {
    return {
      zoneId: null,
      issues: [
        issue(
          CONTRACT_ISSUE_CODES.ZONE_AMBIGUOUS,
          `Объект «${object.id}» одинаково глубоко лежит в зонах: ${deepest
            .map((entry) => entry.zone.id)
            .join(', ')}.`,
          [ref, ...deepest.map((entry): Ref => ({ kind: 'zone', id: entry.zone.id }))],
          shape,
        ),
      ],
    };
  }

  return { zoneId: deepest[0]!.zone.id, issues: [] };
}

/**
 * Recomputes every object→zone link. Unassigned objects are not a failure:
 * the document stays editable and validatePlan reports them. ok:false is kept
 * for a structural problem — here, a parentId cycle.
 */
export function reconcileZones(plan: PlanDocument): Result<PlanDocument> {
  if (hasZoneCycle(plan.zones)) {
    return {
      ok: false,
      issues: [
        {
          code: CONTRACT_ISSUE_CODES.ZONE_CYCLE,
          severity: 'error',
          message: 'Вложенность зон замыкается в цикл, связи пересчитать нельзя.',
          refs: plan.zones.map((zone): Ref => ({ kind: 'zone', id: zone.id })),
        },
      ],
    };
  }

  // Unusable room or zone geometry: drop every link rather than invent one.
  // contracts-v1.md requires this for the intermediate document, so a broken
  // polygon cannot leave a stale assignment behind that looks trustworthy.
  const roomUnusable = !isSimplePolygon(plan.room.boundary);
  const zoneUnusable = plan.zones.some((zone) => !isSimplePolygon(zone.polygon));
  if (roomUnusable || zoneUnusable) {
    return {
      ok: true,
      value: {
        ...plan,
        objects: plan.objects.map((object) => ({ ...object, zoneId: null })),
      },
    };
  }

  const prepared = prepareZones(plan.zones);
  return {
    ok: true,
    value: {
      ...plan,
      objects: plan.objects.map((object) => ({
        ...object,
        zoneId: resolveZone(object, plan.zones, prepared).zoneId,
      })),
    },
  };
}

/** Every issue the current links produce, without changing the document. */
export function relationIssues(plan: PlanDocument): Issue[] {
  if (!isSimplePolygon(plan.room.boundary)) {
    return [
      issue(
        CONTRACT_ISSUE_CODES.RELATIONS_STALE,
        'Геометрия помещения невычислима: связи объектов с зонами требуют пересчёта.',
        [{ kind: 'room', id: plan.room.id }],
      ),
    ];
  }

  const brokenZones = plan.zones.filter((zone) => !isSimplePolygon(zone.polygon));
  if (brokenZones.length > 0) {
    return brokenZones.map((zone) =>
      issue(
        CONTRACT_ISSUE_CODES.RELATIONS_STALE,
        `Геометрия зоны «${zone.id}» невычислима: связи объектов с зонами требуют пересчёта.`,
        [{ kind: 'zone', id: zone.id }],
        zone.polygon,
      ),
    );
  }
  const prepared = prepareZones(plan.zones);
  return plan.objects.flatMap((object) => resolveZone(object, plan.zones, prepared).issues);
}
