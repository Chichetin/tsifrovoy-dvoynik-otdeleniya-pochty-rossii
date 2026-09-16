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
import { contains, footprint, isSimplePolygon } from '../geometry';

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

/**
 * Nesting depth of a zone, 0 for a root. Returns null when the parent chain
 * does not terminate, so a cycle never turns into an endless walk.
 */
export function zoneDepth(zoneId: Id, zones: Zone[]): number | null {
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
 * Assigns an object to the deepest zone containing its whole footprint.
 * Several equally deep candidates leave it unassigned with ZONE_AMBIGUOUS:
 * guessing would silently misplace it in the inventory.
 */
export function resolveZone(object: Equipment, zones: Zone[]): ZoneResolution {
  const ref: Ref = { kind: 'object', id: object.id };
  const shape = footprint(object);

  const usable = zones.filter((zone) => isSimplePolygon(zone.polygon));
  const unusable = zones.filter((zone) => !isSimplePolygon(zone.polygon));

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

  const containing = usable.filter((zone) => contains(zone.polygon, shape));
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

  const depths = containing.map((zone) => ({
    zone,
    depth: zoneDepth(zone.id, zones) ?? -1,
  }));
  const maxDepth = Math.max(...depths.map((entry) => entry.depth));
  const deepest = depths.filter((entry) => entry.depth === maxDepth);

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

  return {
    ok: true,
    value: {
      ...plan,
      objects: plan.objects.map((object) => ({
        ...object,
        zoneId: resolveZone(object, plan.zones).zoneId,
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
  return plan.objects.flatMap((object) => resolveZone(object, plan.zones).issues);
}
