/**
 * V01: what is wrong with this plan.
 *
 * The document is never changed here — every problem comes back as an `Issue`
 * carrying the ids it is about and, where there is something to show, the
 * polygon that shows it, so the editor can highlight the spot instead of only
 * listing a sentence.
 *
 * Severity follows the source of the rule, not our taste. Geometry that the
 * model cannot hold — an object outside the room, two solid objects in the same
 * place, a rack through a wall — is an error. A stocking rule marked
 * `team-assumption` is a warning, because it is our invention and the jury must
 * be able to tell it from a requirement; a rule taken from the organizers'
 * material stays an error.
 */

import {
  type Catalog,
  type Equipment,
  type Id,
  type Issue,
  type Opening,
  type PlanDocument,
  type Point,
  type Polygon,
  type Ref,
  type Rule,
  type Severity,
  type Wall,
  type Zone,
} from '../../contracts/model';
import { findObjectType } from '../catalog';
import {
  contains,
  footprint,
  isSimplePolygon,
  objectHitsWall,
  objectsShareSpace,
} from '../geometry';
import { relationIssues } from '../relations';

/** Codes owned by this module. */
export const VALIDATION_ISSUE_CODES = {
  /** A polygon self-intersects, so nothing can be computed on it. */
  POLYGON_UNUSABLE: 'POLYGON_UNUSABLE',
  /** A zone reaches outside the room. */
  ZONE_OUTSIDE_ROOM: 'ZONE_OUTSIDE_ROOM',
  /** A nested zone is not contained by its parent. */
  ZONE_OUTSIDE_PARENT: 'ZONE_OUTSIDE_PARENT',
  /** An object reaches outside the room. */
  OBJECT_OUTSIDE_ROOM: 'OBJECT_OUTSIDE_ROOM',
  /** The zone an object claims does not contain it. */
  OBJECT_OUTSIDE_ZONE: 'OBJECT_OUTSIDE_ZONE',
  /** Two physical objects occupy the same space. */
  OBJECT_COLLISION: 'OBJECT_COLLISION',
  /** An object runs into a solid part of a wall. */
  OBJECT_HITS_WALL: 'OBJECT_HITS_WALL',
  /** Fewer objects of a type than a stocking rule requires. */
  RULE_COUNT_BELOW_MIN: 'RULE_COUNT_BELOW_MIN',
  /** More objects of a type than a stocking rule allows. */
  RULE_COUNT_ABOVE_MAX: 'RULE_COUNT_ABOVE_MAX',
  /** An object stands farther from the entrance than its rule allows. */
  RULE_TOO_FAR_FROM_ENTRANCE: 'RULE_TOO_FAR_FROM_ENTRANCE',
  /** A distance rule cannot be checked because the plan has no entrance. */
  RULE_ENTRANCE_MISSING: 'RULE_ENTRANCE_MISSING',
} as const;

function issue(
  code: string,
  severity: Severity,
  message: string,
  refs: Ref[],
  polygon?: Polygon,
): Issue {
  return polygon === undefined
    ? { code, severity, message, refs }
    : { code, severity, message, refs, polygon };
}

/** A team rule is a warning, an organizers' rule is an error. */
function severityOf(rule: Rule): Severity {
  return rule.source === 'organizer-material' ? 'error' : 'warning';
}

function ruleNote(rule: Rule): string {
  return rule.source === 'organizer-material'
    ? `Источник правила: материалы организаторов (${rule.id}).`
    : `Источник правила: допущение команды, не норматив Почты (${rule.id}).`;
}

/**
 * Every problem of the current document. Structural breakage — duplicate ids,
 * references into nothing, a version from the future — is refused earlier, by
 * the schema; what is left here is a plan that loads and is still wrong.
 */
export function validatePlan(plan: PlanDocument): Issue[] {
  const unusable = unusableGeometry(plan);
  // Containment, collisions and areas are meaningless on a self-intersecting
  // polygon, so the first thing to fix is reported alone.
  if (unusable.length > 0) return unusable;

  return [
    ...zoneIssues(plan),
    ...objectPlacementIssues(plan),
    ...collisionIssues(plan),
    ...wallIssues(plan),
    ...ruleIssues(plan),
    ...relationIssues(plan),
  ];
}

function unusableGeometry(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  if (!isSimplePolygon(plan.room.boundary)) {
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.POLYGON_UNUSABLE,
        'error',
        'Контур помещения пересекает сам себя: расчёты по нему невозможны.',
        [{ kind: 'room', id: plan.room.id }],
        plan.room.boundary,
      ),
    );
  }
  for (const zone of plan.zones) {
    if (isSimplePolygon(zone.polygon)) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.POLYGON_UNUSABLE,
        'error',
        `Контур зоны «${zone.name}» пересекает сам себя: расчёты по нему невозможны.`,
        [{ kind: 'zone', id: zone.id }],
        zone.polygon,
      ),
    );
  }
  return issues;
}

function zoneIssues(plan: PlanDocument): Issue[] {
  const byId = new Map(plan.zones.map((zone) => [zone.id, zone]));
  const issues: Issue[] = [];

  for (const zone of plan.zones) {
    if (!contains(plan.room.boundary, zone.polygon)) {
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.ZONE_OUTSIDE_ROOM,
          'error',
          `Зона «${zone.name}» выходит за границы помещения.`,
          [
            { kind: 'zone', id: zone.id },
            { kind: 'room', id: plan.room.id },
          ],
          zone.polygon,
        ),
      );
    }

    if (zone.parentId === null) continue;
    const parent = byId.get(zone.parentId);
    if (parent === undefined || contains(parent.polygon, zone.polygon)) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.ZONE_OUTSIDE_PARENT,
        'error',
        `Зона «${zone.name}» не лежит целиком в родительской зоне «${parent.name}».`,
        [
          { kind: 'zone', id: zone.id },
          { kind: 'zone', id: parent.id },
        ],
        zone.polygon,
      ),
    );
  }
  return issues;
}

function objectPlacementIssues(plan: PlanDocument): Issue[] {
  const byId = new Map(plan.zones.map((zone) => [zone.id, zone]));
  const issues: Issue[] = [];

  for (const object of plan.objects) {
    const shape = footprint(object);

    if (!contains(plan.room.boundary, shape)) {
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM,
          'error',
          `Объект «${object.label}» выходит за границы помещения.`,
          [
            { kind: 'object', id: object.id },
            { kind: 'room', id: plan.room.id },
          ],
          shape,
        ),
      );
    }

    if (object.zoneId === null) continue;
    const zone = byId.get(object.zoneId);
    if (zone === undefined || contains(zone.polygon, shape)) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE,
        'error',
        `Объект «${object.label}» отнесён к зоне «${zone.name}», но не лежит в ней целиком.`,
        [
          { kind: 'object', id: object.id },
          { kind: 'zone', id: zone.id },
        ],
        shape,
      ),
    );
  }
  return issues;
}

/** Only objects the catalog calls physical take part in collisions. */
function collisionIssues(plan: PlanDocument): Issue[] {
  const solid = plan.objects.filter((object) => isPhysical(plan.catalog, object));
  const issues: Issue[] = [];

  for (let left = 0; left < solid.length; left += 1) {
    for (let right = left + 1; right < solid.length; right += 1) {
      const a = solid[left];
      const b = solid[right];
      if (a === undefined || b === undefined) continue;
      if (!objectsShareSpace(a, b)) continue;
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
          'error',
          `Объекты «${a.label}» и «${b.label}» занимают одно место.`,
          [
            { kind: 'object', id: a.id },
            { kind: 'object', id: b.id },
          ],
          footprint(a),
        ),
      );
    }
  }
  return issues;
}

function wallIssues(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  for (const object of plan.objects) {
    if (!isPhysical(plan.catalog, object)) continue;
    for (const wall of plan.walls) {
      if (!objectHitsWall(object, wall, plan.openings)) continue;
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
          'error',
          `Объект «${object.label}» пересекает стену «${wall.id}».`,
          [
            { kind: 'object', id: object.id },
            { kind: 'wall', id: wall.id },
          ],
          footprint(object),
        ),
      );
    }
  }
  return issues;
}

function isPhysical(catalog: Catalog, object: Equipment): boolean {
  // An unknown type is treated as solid: the schema refuses such a document on
  // load, and during an edit a silent "not physical" would hide a collision.
  return findObjectType(catalog, object.typeId)?.physical ?? true;
}

function ruleIssues(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  for (const rule of plan.catalog.rules) {
    if (rule.kind === 'count') issues.push(...countRuleIssues(plan, rule));
    else issues.push(...distanceRuleIssues(plan, rule));
  }
  return issues;
}

function countRuleIssues(
  plan: PlanDocument,
  rule: Extract<Rule, { kind: 'count' }>,
): Issue[] {
  const descendants = descendantsOf(plan.zones);
  const issues: Issue[] = [];

  for (const zone of plan.zones) {
    if (zone.typeId !== rule.zoneTypeId) continue;

    const scope =
      rule.scope === 'direct'
        ? new Set([zone.id])
        : new Set([zone.id, ...(descendants.get(zone.id) ?? [])]);
    const count = plan.objects.filter(
      (object) =>
        object.typeId === rule.objectTypeId &&
        object.zoneId !== null &&
        scope.has(object.zoneId),
    ).length;

    const where = rule.scope === 'direct' ? 'без вложенных зон' : 'вместе с вложенными зонами';
    if (rule.min !== null && count < rule.min) {
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN,
          severityOf(rule),
          `В зоне «${zone.name}» ${count} шт. «${rule.objectTypeId}» при минимуме ${rule.min} (${where}). ${ruleNote(rule)}`,
          [{ kind: 'zone', id: zone.id }],
          zone.polygon,
        ),
      );
    }
    if (rule.max !== null && count > rule.max) {
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX,
          severityOf(rule),
          `В зоне «${zone.name}» ${count} шт. «${rule.objectTypeId}» при максимуме ${rule.max} (${where}). ${ruleNote(rule)}`,
          [{ kind: 'zone', id: zone.id }],
          zone.polygon,
        ),
      );
    }
  }
  return issues;
}

function distanceRuleIssues(
  plan: PlanDocument,
  rule: Extract<Rule, { kind: 'distance-to-entrance' }>,
): Issue[] {
  const targets = plan.objects.filter((object) => object.typeId === rule.objectTypeId);
  if (targets.length === 0) return [];

  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const entrances = plan.openings
    .filter((opening) =>
      rule.entranceId === null ? opening.kind === 'entrance' : opening.id === rule.entranceId,
    )
    .flatMap((opening) => {
      const wall = walls.get(opening.wallId);
      return wall === undefined ? [] : [{ opening, point: openingCentre(opening, wall) }];
    });

  if (entrances.length === 0) {
    return [
      issue(
        VALIDATION_ISSUE_CODES.RULE_ENTRANCE_MISSING,
        severityOf(rule),
        `Правило «${rule.id}» требует вход, но входов в плане нет: расстояние проверить нечем. ${ruleNote(rule)}`,
        [],
      ),
    ];
  }

  const issues: Issue[] = [];
  for (const object of targets) {
    let nearest = entrances[0];
    if (nearest === undefined) continue;
    let best = distance(object.position, nearest.point);
    for (const entrance of entrances) {
      const measured = distance(object.position, entrance.point);
      if (measured >= best) continue;
      best = measured;
      nearest = entrance;
    }
    if (best <= rule.maxDistance_m) continue;

    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE,
        severityOf(rule),
        `Объект «${object.label}» в ${best.toFixed(2)} м от входа «${nearest.opening.id}» при норме не более ${rule.maxDistance_m} м. ${ruleNote(rule)}`,
        [
          { kind: 'object', id: object.id },
          { kind: 'opening', id: nearest.opening.id },
        ],
        footprint(object),
      ),
    );
  }
  return issues;
}

/** Middle of the opening, measured along its wall from the wall's `from` end. */
function openingCentre(opening: Opening, wall: Wall): Point {
  const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
  if (length === 0) return wall.from;
  const along = opening.offset_m + opening.width_m / 2;
  return [
    wall.from[0] + ((wall.to[0] - wall.from[0]) / length) * along,
    wall.from[1] + ((wall.to[1] - wall.from[1]) / length) * along,
  ];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Every zone below each zone, with a guard so a cycle cannot hang the check. */
function descendantsOf(zones: Zone[]): Map<Id, Id[]> {
  const children = new Map<Id, Id[]>();
  for (const zone of zones) {
    if (zone.parentId === null) continue;
    children.set(zone.parentId, [...(children.get(zone.parentId) ?? []), zone.id]);
  }

  const result = new Map<Id, Id[]>();
  for (const zone of zones) {
    const collected: Id[] = [];
    const seen = new Set<Id>([zone.id]);
    const queue = [...(children.get(zone.id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      collected.push(next);
      queue.push(...(children.get(next) ?? []));
    }
    result.set(zone.id, collected);
  }
  return result;
}
