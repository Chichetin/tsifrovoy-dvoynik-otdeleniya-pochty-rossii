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
} from '../../contracts/model';
import { findObjectType } from '../catalog';
import { outerWallIds } from '../commands/room-walls';
import { countInZoneScope } from '../inventory';
import {
  boundingBox,
  boxesOverlap,
  contains,
  footprint,
  intersects,
  intervalsOverlap,
  isSimplePolygon,
  polygonArea,
  objectHitsWall,
  objectInterval,
  openingCentre,
  segmentLength,
} from '../geometry';
import { NBSP, formatLength, formatShort } from '../number-format';
import { RELATION_ISSUE_CODES, relationIssues } from '../relations';

/** UI metadata kept outside the persisted, shared Issue contract. */
export type ValidationIssue = Issue & { ruleIds?: Id[] };

/** Codes owned by this module. */
export const VALIDATION_ISSUE_CODES = {
  /** A polygon self-intersects, so nothing can be computed on it. */
  POLYGON_UNUSABLE: 'POLYGON_UNUSABLE',
  /** A zone reaches outside the room. */
  ZONE_OUTSIDE_ROOM: 'ZONE_OUTSIDE_ROOM',
  /** A nested zone is not contained by its parent. */
  ZONE_OUTSIDE_PARENT: 'ZONE_OUTSIDE_PARENT',
  /** Two zones share floor without one being nested in the other. */
  ZONE_OVERLAPS_ZONE: 'ZONE_OVERLAPS_ZONE',
  /** An object reaches outside the room. */
  OBJECT_OUTSIDE_ROOM: 'OBJECT_OUTSIDE_ROOM',
  /** The zone an object claims does not contain it. */
  OBJECT_OUTSIDE_ZONE: 'OBJECT_OUTSIDE_ZONE',
  /** Two physical objects occupy the same space. */
  OBJECT_COLLISION: 'OBJECT_COLLISION',
  /** An object runs into a solid part of a wall. */
  OBJECT_HITS_WALL: 'OBJECT_HITS_WALL',
  /** Two objects carry the same non-empty inventory number. */
  OBJECT_DUPLICATE_INVENTORY_NUMBER: 'OBJECT_DUPLICATE_INVENTORY_NUMBER',
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
  ruleIds?: Id[],
): ValidationIssue {
  const base: Issue = polygon === undefined
    ? { code, severity, message, refs }
    : { code, severity, message, refs, polygon };
  return ruleIds === undefined ? base : { ...base, ruleIds };
}

/** A team rule is a warning, an organizers' rule is an error. */
function severityOf(rule: Rule): Severity {
  return rule.source === 'organizer-material' ? 'error' : 'warning';
}

function ruleNote(rule: Rule): string {
  return rule.source === 'organizer-material'
    ? 'Источник правила: материалы организаторов.'
    : 'Источник правила: допущение команды, не норматив Почты.';
}

/** User-facing subjects: ids stay in refs for focus, not in the sentence. */
function objectTypeName(plan: PlanDocument, typeId: string): string {
  return findObjectType(plan.catalog, typeId)?.label ?? typeId;
}

function wallName(isOuter: boolean): string {
  return isOuter ? 'наружную стену' : 'перегородку';
}

function openingName(opening: Opening): string {
  if (opening.kind === 'entrance') return 'главного входа';
  if (opening.kind === 'door') return 'двери';
  return 'окна';
}

/**
 * Every problem of the current document. Structural breakage — duplicate ids,
 * references into nothing, a version from the future — is refused earlier, by
 * the schema; what is left here is a plan that loads and is still wrong.
 */
export function validatePlan(plan: PlanDocument): ValidationIssue[] {
  const unusable = unusableGeometry(plan);
  // Containment, collisions and areas are meaningless on a self-intersecting
  // polygon, so the first thing to fix is reported alone.
  if (unusable.length > 0) return unusable;

  const placement = objectPlacementIssues(plan);
  return [
    ...zoneIssues(plan),
    ...placement,
    ...collisionIssues(plan),
    ...wallIssues(plan),
    ...inventoryNumberIssues(plan),
    ...ruleIssues(plan),
    ...withoutRepeats(relationIssues(plan), placement),
  ];
}

/**
 * One problem, one line (D-157). An object that claims a zone and does not
 * fit in it is already reported by OBJECT_OUTSIDE_ZONE, which names the zone;
 * "fits in no zone at all" about the same object would be the same footprint
 * said twice. The relation warning stays for objects without a claimed zone.
 */
function withoutRepeats(relations: Issue[], placement: Issue[]): Issue[] {
  const outsideOwnZone = new Set(
    placement
      .filter((entry) => entry.code === VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE)
      .map((entry) => entry.refs[0]?.id),
  );
  return relations.filter(
    (entry) =>
      entry.code !== RELATION_ISSUE_CODES.ZONE_UNASSIGNED ||
      !outsideOwnZone.has(entry.refs[0]?.id),
  );
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

  issues.push(...zoneOverlapIssues(plan));
  return issues;
}

/**
 * Зоны делят пол только по вложенности: если две зоны налезают друг на друга,
 * не вкладываясь, объект в общей части одинаково глубоко лежит в обеих и
 * теряет зону. Без этой находки человек видит только по метке на каждом
 * объекте и не понимает, что чинить (D-223).
 */
function zoneOverlapIssues(plan: PlanDocument): Issue[] {
  const usable = plan.zones
    .filter((zone) => isSimplePolygon(zone.polygon))
    .map((zone) => ({ zone, area: polygonArea(zone.polygon) }));
  const issues: Issue[] = [];

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const first = usable[i]!;
      const second = usable[j]!;
      // `intersects` отсеивает зоны встык и по охватам: общей площади нет.
      if (!intersects(first.zone.polygon, second.zone.polygon)) continue;
      const firstInside = contains(second.zone.polygon, first.zone.polygon);
      const secondInside = contains(first.zone.polygon, second.zone.polygon);
      // Ровно одно вложение — это иерархия зон, а не находка. Равные контуры
      // вкладываются друг в друга оба сразу и родителя не получают.
      if (firstInside !== secondInside) continue;
      // Подсвечивается меньшая: обычно это та, которую только что обвели.
      const smaller = first.area <= second.area ? first.zone : second.zone;
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE,
          'warning',
          `Зоны «${first.zone.name}» и «${second.zone.name}» пересекаются, не вкладываясь одна в другую: объекты в общей части не могут определить свою зону. Вложите одну в другую или разведите границы.`,
          [
            { kind: 'zone', id: first.zone.id },
            { kind: 'zone', id: second.zone.id },
          ],
          smaller.polygon,
        ),
      );
    }
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
  // Footprints once, not once per pair: with a thousand objects the pairs run
  // to half a million, and a box test settles almost all of them (D-205).
  const solid = plan.objects
    .filter((object) => isPhysical(plan.catalog, object))
    .map((object) => {
      const shape = footprint(object);
      return { object, shape, box: boundingBox(shape), interval: objectInterval(object) };
    });
  const issues: Issue[] = [];

  for (let left = 0; left < solid.length; left += 1) {
    for (let right = left + 1; right < solid.length; right += 1) {
      const a = solid[left];
      const b = solid[right];
      if (a === undefined || b === undefined) continue;
      if (!boxesOverlap(a.box, b.box)) continue;
      if (!intervalsOverlap(a.interval, b.interval)) continue;
      if (!intersects(a.shape, b.shape)) continue;
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
          'error',
          `Объекты «${a.object.label}» и «${b.object.label}» занимают одно место.`,
          [
            { kind: 'object', id: a.object.id },
            { kind: 'object', id: b.object.id },
          ],
          a.shape,
        ),
      );
    }
  }
  return issues;
}

function wallIssues(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  const outer = outerWallIds(plan.walls, plan.room.boundary);
  for (const object of plan.objects) {
    if (!isPhysical(plan.catalog, object)) continue;
    for (const wall of plan.walls) {
      if (!objectHitsWall(object, wall, plan.openings)) continue;
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
          'error',
          `Объект «${object.label}» пересекает ${wallName(outer.has(wall.id))}.`,
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

/**
 * Attribute key of the inventory number: the same string as in
 * `data/catalog/object-types.json` and `INVENTORY_NUMBER_KEY` of the inventory
 * list. Domain code cannot import a feature, so the key is repeated here.
 */
const INVENTORY_NUMBER_KEY = 'inventoryNumber';

/** Read the way the inventory list reads it: trimmed string or finite number. */
function inventoryNumberOf(object: Equipment): string | null {
  const value = object.attributes[INVENTORY_NUMBER_KEY];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * An inventory number names one physical item, so two objects with the same
 * number are one mistake in the inventory (D-266). Every repeat is reported
 * against the first holder in plan order: the repeat comes first in `refs`
 * and its footprint is highlighted, because the later object is usually the
 * copy that needs a number of its own. A warning, not an error: the plan's
 * geometry is intact, the attribute is typed by a person.
 */
function inventoryNumberIssues(plan: PlanDocument): Issue[] {
  const firstHolder = new Map<string, Equipment>();
  const issues: Issue[] = [];
  for (const object of plan.objects) {
    const number = inventoryNumberOf(object);
    if (number === null) continue;
    const first = firstHolder.get(number);
    if (first === undefined) {
      firstHolder.set(number, object);
      continue;
    }
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.OBJECT_DUPLICATE_INVENTORY_NUMBER,
        'warning',
        `Инвентарный номер «${number}» у объекта «${object.label}» уже присвоен объекту «${first.label}»: у каждого предмета свой номер.`,
        [
          { kind: 'object', id: object.id },
          { kind: 'object', id: first.id },
        ],
        footprint(object),
      ),
    );
  }
  return issues;
}

function isPhysical(catalog: Catalog, object: Equipment): boolean {
  // An unknown type is treated as solid: the schema refuses such a document on
  // load, and during an edit a silent "not physical" would hide a collision.
  return findObjectType(catalog, object.typeId)?.physical ?? true;
}

function ruleIssues(plan: PlanDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const rule of plan.catalog.rules) {
    if (rule.kind === 'count') issues.push(...countRuleIssues(plan, rule));
    else issues.push(...distanceRuleIssues(plan, rule));
  }
  return issues;
}

function countRuleIssues(
  plan: PlanDocument,
  rule: Extract<Rule, { kind: 'count' }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const zone of plan.zones) {
    if (zone.typeId !== rule.zoneTypeId) continue;

    // Считает инвентаризация: у проверки и у рекомендации ассистента должно
    // получаться одно и то же число.
    const count = countInZoneScope(plan, rule.objectTypeId, zone.id, rule.scope);

    const where = rule.scope === 'direct' ? 'без вложенных зон' : 'вместе с вложенными зонами';
    if (rule.min !== null && count < rule.min) {
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN,
          severityOf(rule),
          `В зоне «${zone.name}» ${count} шт. «${objectTypeName(plan, rule.objectTypeId)}» при минимуме ${rule.min} (${where}). ${ruleNote(rule)}`,
          [{ kind: 'zone', id: zone.id }],
          zone.polygon,
          [rule.id],
        ),
      );
    }
    if (rule.max !== null && count > rule.max) {
      issues.push(
        issue(
          VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX,
          severityOf(rule),
          `В зоне «${zone.name}» ${count} шт. «${objectTypeName(plan, rule.objectTypeId)}» при максимуме ${rule.max} (${where}). ${ruleNote(rule)}`,
          [{ kind: 'zone', id: zone.id }],
          zone.polygon,
          [rule.id],
        ),
      );
    }
  }
  return issues;
}

function distanceRuleIssues(
  plan: PlanDocument,
  rule: Extract<Rule, { kind: 'distance-to-entrance' }>,
): ValidationIssue[] {
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
        `Для «${objectTypeName(plan, rule.objectTypeId)}» требуется проверить расстояние до входа, но входов в плане нет. ${ruleNote(rule)}`,
        [],
        undefined,
        [rule.id],
      ),
    ];
  }

  const issues: ValidationIssue[] = [];
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
        `Объект «${object.label}» в ${formatLength(best)} от ${openingName(nearest.opening)} при норме не более ${formatShort(rule.maxDistance_m, 2)}${NBSP}м. ${ruleNote(rule)}`,
        [
          { kind: 'object', id: object.id },
          { kind: 'opening', id: nearest.opening.id },
        ],
        footprint(object),
        [rule.id],
      ),
    );
  }
  return issues;
}

function distance(a: Point, b: Point): number {
  return segmentLength(a, b);
}
