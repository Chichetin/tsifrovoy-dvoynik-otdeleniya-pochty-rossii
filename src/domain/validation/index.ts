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
  type CountRule,
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
  type Zone,
  TOLERANCE,
} from '../../contracts/model';
import { findObjectType } from '../catalog';
import { carriesInventoryNumber, inventoryNumberOf } from '../commands';
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
  openingClearance,
  segmentLength,
} from '../geometry';
import { NBSP, formatLength, formatShort } from '../number-format';
import { RELATION_ISSUE_CODES, relationIssues } from '../relations';
import { MAINTENANCE_WARNING_DAYS, localToday, maintenanceStatus } from './maintenance';

export {
  MAINTENANCE_DATE_KEY,
  MAINTENANCE_WARNING_DAYS,
  type MaintenanceStatus,
  localToday,
  maintenanceStatus,
} from './maintenance';

/**
 * The segment a distance rule measured: from the object's centre to the
 * entrance point, in metres. The plan draws it next to the finding.
 */
export type IssueMeasure = { from: Point; to: Point; distance_m: number };

/** UI metadata kept outside the persisted, shared Issue contract. */
export type ValidationIssue = Issue & { ruleIds?: Id[]; measure?: IssueMeasure };

/** Codes owned by this module. */
export const VALIDATION_ISSUE_CODES = {
  /** A polygon (room, zone or object outline) self-intersects, so nothing can be computed on it. */
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
  /** An object stands in the free floor in front of a door or the entrance. */
  OBJECT_BLOCKS_OPENING: 'OBJECT_BLOCKS_OPENING',
  /** Desk equipment above the floor has no surface under it. */
  OBJECT_UNSUPPORTED: 'OBJECT_UNSUPPORTED',
  /** An object's top rises above the ceiling of its own room. */
  OBJECT_ABOVE_CEILING: 'OBJECT_ABOVE_CEILING',
  /** Two objects carry the same non-empty inventory number. */
  OBJECT_DUPLICATE_INVENTORY_NUMBER: 'OBJECT_DUPLICATE_INVENTORY_NUMBER',
  /** A physical object whose type declares an inventory number has none. */
  OBJECT_MISSING_INVENTORY_NUMBER: 'OBJECT_MISSING_INVENTORY_NUMBER',
  /** Fewer objects of a type than a stocking rule requires. */
  RULE_COUNT_BELOW_MIN: 'RULE_COUNT_BELOW_MIN',
  /** More objects of a type than a stocking rule allows. */
  RULE_COUNT_ABOVE_MAX: 'RULE_COUNT_ABOVE_MAX',
  /** An object stands farther from the entrance than its rule allows. */
  RULE_TOO_FAR_FROM_ENTRANCE: 'RULE_TOO_FAR_FROM_ENTRANCE',
  /** A distance rule cannot be checked because the plan has no entrance. */
  RULE_ENTRANCE_MISSING: 'RULE_ENTRANCE_MISSING',
  /** The next maintenance date of an object has passed. */
  MAINTENANCE_OVERDUE: 'MAINTENANCE_OVERDUE',
  /** The next maintenance date is today or within the warning window. */
  MAINTENANCE_DUE_SOON: 'MAINTENANCE_DUE_SOON',
  /** The next maintenance attribute holds text that is not a date. */
  MAINTENANCE_DATE_INVALID: 'MAINTENANCE_DATE_INVALID',
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
    : 'Источник правила: справочник проекта.';
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
export function validatePlan(plan: PlanDocument, today: string = localToday()): ValidationIssue[] {
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
    ...plan.objects.flatMap((object) => objectOpeningIssues(plan, object)),
    ...plan.objects.flatMap((object) => objectSupportIssues(plan, object)),
    ...ceilingIssues(plan),
    ...inventoryNumberIssues(plan),
    ...missingInventoryNumberIssues(plan),
    ...maintenanceIssues(plan, today),
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
  // An outline of its own (D-277) can cross itself like a zone can; a
  // rectangle never does, so only objects that carry an outline are checked.
  for (const object of plan.objects) {
    if (object.outline === undefined) continue;
    const shape = footprint(object);
    if (isSimplePolygon(shape)) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.POLYGON_UNUSABLE,
        'error',
        `Контур объекта «${object.label}» пересекает сам себя: расчёты по нему невозможны.`,
        [{ kind: 'object', id: object.id }],
        shape,
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

/** Team rule: floor this deep in front of a door or the entrance stays free, on both sides of the wall. */
export const OPENING_CLEARANCE_M = 0.9;

/**
 * A physical object in the clearance of a door or the entrance. Height counts:
 * a camera above the lintel blocks nothing. A window is not a passage.
 */
export function objectOpeningIssues(plan: PlanDocument, object: Equipment): Issue[] {
  if (!isPhysical(plan.catalog, object)) return [];
  const shape = footprint(object);
  const interval = objectInterval(object);
  const issues: Issue[] = [];
  for (const opening of plan.openings) {
    if (opening.kind === 'window') continue;
    if (!intervalsOverlap(interval, { base_m: opening.sill_m, top_m: opening.sill_m + opening.height_m })) continue;
    const wall = plan.walls.find((entry) => entry.id === opening.wallId);
    if (wall === undefined) continue;
    const clearance = openingClearance(opening, wall, OPENING_CLEARANCE_M);
    if (clearance.length === 0 || !intersects(shape, clearance)) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.OBJECT_BLOCKS_OPENING,
        'error',
        `Объект «${object.label}» загораживает проём ${openingName(opening)}: с обеих сторон нужно ${formatLength(OPENING_CLEARANCE_M)} свободного пола.`,
        [
          { kind: 'object', id: object.id },
          { kind: 'opening', id: opening.id },
        ],
        clearance,
      ),
    );
  }
  return issues;
}

/**
 * Height of the work surface: `ot_workplace` is 0.75 m tall, and every piece of
 * desk equipment (computer, printer, label printer, POS terminal, scales) has
 * `defaultBase_m` 0.75 m. Anything mounted higher hangs on a wall, not on furniture.
 */
export const WORK_SURFACE_M = 0.75;

/** Desk equipment by its type: off the floor exactly at the work surface. */
function isDeskEquipment(catalog: Catalog, object: Equipment): boolean {
  const type = findObjectType(catalog, object.typeId);
  if (type === null || type.occupiesFloor) return false;
  return Math.abs(type.defaultBase_m - WORK_SURFACE_M) <= TOLERANCE.coordinate_m;
}

/**
 * Desk equipment raised off the floor stands on a physical object whose top is
 * at its base and whose outline holds its outline. On the floor it needs nothing.
 */
export function objectSupportIssues(plan: PlanDocument, object: Equipment): Issue[] {
  if (!isDeskEquipment(plan.catalog, object)) return [];
  if (object.base_m <= TOLERANCE.coordinate_m) return [];
  const shape = footprint(object);
  for (const other of plan.objects) {
    if (other.id === object.id || !isPhysical(plan.catalog, other)) continue;
    if (Math.abs(other.base_m + other.height_m - object.base_m) > TOLERANCE.coordinate_m) continue;
    if (contains(footprint(other), shape)) return [];
  }
  return [
    issue(
      VALIDATION_ISSUE_CODES.OBJECT_UNSUPPORTED,
      'error',
      `Объект «${object.label}» висит на высоте ${formatLength(object.base_m)}: под ним нет стола, на котором он целиком помещается.`,
      [{ kind: 'object', id: object.id }],
      shape,
    ),
  ];
}

function wallIssues(plan: PlanDocument): Issue[] {
  const issues: Issue[] = [];
  const outer = outerWallIds(plan.walls, plan.room.boundary);
  for (const object of plan.objects) {
    if (!isPhysical(plan.catalog, object)) continue;
    for (const wall of plan.walls) {
      if (!objectHitsWall(object, wall, plan.openings, plan.walls)) continue;
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

/**
 * D-312: a physical object of a type that declares an inventory number, but
 * holding none, is an item the register does not know. Placement from the
 * library numbers the object itself (D-310), so this fires on copies (D-266),
 * on a number wiped in the card and on files written without numbers. A
 * warning like the duplicate: the geometry is intact, a person types the
 * number from the item's label. Non-physical marks and types without the
 * attribute are not asked for one. A plan where no object has a number does
 * not keep a register at all (the organizers' example): nine warnings there
 * would bury its geometry traps and say one thing nine times, so it is silent.
 */
function missingInventoryNumberIssues(plan: PlanDocument): Issue[] {
  if (!plan.objects.some((object) => inventoryNumberOf(object) !== null)) return [];
  const issues: Issue[] = [];
  for (const object of plan.objects) {
    if (!carriesInventoryNumber(plan.catalog, object.typeId)) continue;
    if (inventoryNumberOf(object) !== null) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.OBJECT_MISSING_INVENTORY_NUMBER,
        'warning',
        `У объекта «${object.label}» нет инвентарного номера: впишите номер с ярлыка предмета в карточке.`,
        [{ kind: 'object', id: object.id }],
        footprint(object),
      ),
    );
  }
  return issues;
}

/**
 * D-286: the room has one ceiling, and nothing hangs through it. A sign at
 * 2,8 m with a 0,4 m body reaches 3,2 m in a room 3,0 m high — the model
 * cannot hold that, so it is an error like an object outside the walls, not a
 * stocking warning. Non-physical objects are checked too: a sensor zone drawn
 * above the slab is as impossible as a solid one.
 */
function ceilingIssues(plan: PlanDocument): Issue[] {
  const ceiling = plan.room.ceilingHeight_m;
  const issues: Issue[] = [];
  for (const object of plan.objects) {
    const top = object.base_m + object.height_m;
    if (top <= ceiling + TOLERANCE.coordinate_m) continue;
    issues.push(
      issue(
        VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING,
        'error',
        `Объект «${object.label}» поднимается до ${formatLength(top)} — выше потолка ${formatLength(ceiling)}.`,
        [
          { kind: 'object', id: object.id },
          { kind: 'room', id: plan.room.id },
        ],
        footprint(object),
      ),
    );
  }
  return issues;
}

/**
 * #29: the next maintenance date (`MAINTENANCE_DATE_KEY`) against `today`
 * («YYYY-MM-DD»). A team rule, so a warning: a date passed — overdue; today
 * or within 14 days — due soon; not a date — the message quotes the text.
 */
function maintenanceIssues(plan: PlanDocument, today: string): Issue[] {
  const note = `Правило команды: предупреждение за ${MAINTENANCE_WARNING_DAYS}${NBSP}дн. до даты «Следующее ТО».`;
  const issues: Issue[] = [];
  for (const object of plan.objects) {
    const status = maintenanceStatus(object, today);
    if (status === null) continue;
    let code: string;
    let message: string;
    if (status.kind === 'overdue') {
      code = VALIDATION_ISSUE_CODES.MAINTENANCE_OVERDUE;
      message = `ТО объекта «${object.label}» просрочено: срок ${status.date}, прошло ${status.days}${NBSP}дн. ${note}`;
    } else if (status.kind === 'due-soon') {
      code = VALIDATION_ISSUE_CODES.MAINTENANCE_DUE_SOON;
      const when = status.days === 0 ? 'сегодня' : `через ${status.days}${NBSP}дн.`;
      message = `ТО объекта «${object.label}» ${when}: срок ${status.date}. ${note}`;
    } else {
      code = VALIDATION_ISSUE_CODES.MAINTENANCE_DATE_INVALID;
      message = `У объекта «${object.label}» в поле «Следующее ТО» не дата: «${status.text}». Впишите дату как 2026-10-18 или 18.10.2026.`;
    }
    issues.push(issue(code, 'warning', message, [{ kind: 'object', id: object.id }], footprint(object)));
  }
  return issues;
}

export function isPhysical(catalog: Catalog, object: Equipment): boolean {
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

/** A zone inside a zone of its own type is a part of that zone, not a zone to stock on its own. */
function nestedInSameType(plan: PlanDocument, zone: Zone): boolean {
  let parentId = zone.parentId;
  // The chain is bounded by the zone count: a closed one is reported elsewhere.
  for (let step = 0; parentId !== null && step < plan.zones.length; step += 1) {
    const parent = plan.zones.find((entry) => entry.id === parentId);
    if (parent === undefined) return false;
    if (parent.typeId === zone.typeId) return true;
    parentId = parent.parentId;
  }
  return false;
}

/** One stocking rule met in one zone: what it asks and what the plan holds. */
export type RuleCount = {
  rule: CountRule;
  zone: Zone;
  /** Counted by the inventory, so the check, the checklist and the assistant agree. */
  count: number;
  /**
   * The outer zone already counts what its nested zones hold (`inclusive`): a
   * minimum asked again of a nested zone of the same type is a false finding
   * (#17). A maximum, and a rule on the zone's own floor (`direct`), still apply.
   */
  minApplies: boolean;
};

/** Every zone of the rule's type with its count. */
function ruleCountsFor(plan: PlanDocument, rule: CountRule): RuleCount[] {
  return plan.zones
    .filter((zone) => zone.typeId === rule.zoneTypeId)
    .map((zone) => ({
      rule,
      zone,
      count: countInZoneScope(plan, rule.objectTypeId, zone.id, rule.scope),
      minApplies: rule.scope !== 'inclusive' || !nestedInSameType(plan, zone),
    }));
}

/** Every stocking rule against every zone it concerns — what the checklist shows. */
export function ruleCounts(plan: PlanDocument): RuleCount[] {
  return plan.catalog.rules.flatMap((rule) => (rule.kind === 'count' ? ruleCountsFor(plan, rule) : []));
}

/** Whether the rule is met in that zone: the same test the findings use. */
export function ruleMet({ rule, count, minApplies }: RuleCount): boolean {
  return !(rule.min !== null && count < rule.min && minApplies) && !(rule.max !== null && count > rule.max);
}

function countRuleIssues(plan: PlanDocument, rule: CountRule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const { zone, count, minApplies } of ruleCountsFor(plan, rule)) {
    const where = rule.scope === 'direct' ? 'без вложенных зон' : 'вместе с вложенными зонами';
    if (rule.min !== null && count < rule.min && minApplies) {
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

    const far = issue(
      VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE,
      severityOf(rule),
      `Объект «${object.label}» в ${formatLength(best)} от ${openingName(nearest.opening)} при норме не более ${formatShort(rule.maxDistance_m, 2)}${NBSP}м. ${ruleNote(rule)}`,
      [
        { kind: 'object', id: object.id },
        { kind: 'opening', id: nearest.opening.id },
      ],
      footprint(object),
      [rule.id],
    );
    issues.push({ ...far, measure: { from: object.position, to: nearest.point, distance_m: best } });
  }
  return issues;
}

function distance(a: Point, b: Point): number {
  return segmentLength(a, b);
}
