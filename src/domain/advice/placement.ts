/**
 * A01: where an object can stand.
 *
 * The search is a bounded sweep, not an optimiser. A grid of 0.1 m and two
 * angles is walked outwards from the anchor, every probe is checked against the
 * room outline, the target zone, the solid parts of walls and the objects that
 * share its height band; the survivors are then put into a copy of the plan and
 * run through the same `validatePlan` the editor shows the user. A candidate is
 * returned only when it adds no new error to the plan.
 *
 * Where the type belongs is data, not code: a count rule that sets a minimum
 * for "objects of type T in zones of type Z" says T is expected in Z, so a
 * search over the whole room only keeps spots whose own (deepest) zone has such
 * a type — see `zoneFit`. A rule with only a maximum is a cap, not a home.
 *
 * Nothing here claims optimality or ergonomics: "не найдено" means "not found on
 * this grid, within this budget", and that limitation travels with the answer
 * (REASON_CODE_SPECS['placement.none']).
 */

import type { Candidate, Fact, FindPlacements } from '../../contracts/advice';
import type {
  Equipment,
  Id,
  Issue,
  ObjectType,
  PlanDocument,
  Point,
  Polygon,
  Ref,
  Rule,
} from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { findObjectType, defaultAttributes } from '../catalog';
import {
  boundingBox,
  boxesOverlap,
  contains,
  footprint,
  intersects,
  intervalsOverlap,
  objectInterval,
  openingCentre,
  locatePoint,
  polygonSegmentDistance,
  wallObstacles,
  type BoundingBox,
  type HeightInterval,
} from '../geometry';
import { measurePlan } from '../metrics';
import { editableContentLayer } from '../content-layer';
import { prepareZones, resolveZone } from '../relations';
import { validatePlan } from '../validation';

/** Codes owned by this module. */
export const PLACEMENT_ISSUE_CODES = {
  /** The requested type is not in the plan's catalog. */
  UNKNOWN_OBJECT_TYPE: 'UNKNOWN_OBJECT_TYPE',
  /** The requested zone is not in the plan. */
  TARGET_ZONE_MISSING: 'TARGET_ZONE_MISSING',
  /** There is no ordinary unlocked layer that may own a new object. */
  TARGET_LAYER_MISSING: 'TARGET_LAYER_MISSING',
} as const;

/**
 * The bounds of the sweep. They are part of the answer's meaning, so they are
 * exported: the UI and the tests quote them instead of restating them.
 */
export const PLACEMENT_SEARCH = {
  /** Grid step for the centre of the object, in metres. */
  step_m: 0.1,
  /** Only axis-aligned and quarter-turned placements are considered. */
  angles_deg: [0, 90],
  /** Upper bound on cells inside the relevant zones and on geometric probes. */
  maxProbes: 60_000,
  /** Safety bound for raw grid cells visited before the zone filter. */
  maxCells: 1_000_000,
  /** How many survivors get the full `validatePlan` treatment. */
  maxVerified: 24,
  /** How many candidates the user is offered. */
  maxCandidates: 3,
  /**
   * Наименьшее расстояние между предлагаемыми вариантами, в метрах.
   *
   * Сетка поиска — 0,1 м, поэтому три лучших места по рангу всегда оказывались
   * соседними клетками: человек видел «три варианта», которые на плане были
   * одной точкой с разницей в шаг сетки и поворот. Варианты обязаны отличаться
   * видимо, иначе выбирать не из чего. Предел берётся по самому объекту — его
   * длинной стороне, но не меньше этого числа для мелочи вроде терминала.
   */
  minSeparation_m: 0.6,
} as const;

/**
 * Варианты, разнесённые по плану: из отсортированного списка берутся лучшие,
 * но каждый следующий — не ближе `separation_m` к уже выбранным.
 *
 * Если разнесённых мест меньше запрошенного числа, вернётся меньше: честнее
 * показать два непохожих места, чем три почти совпадающих.
 */
export function spreadApart<T extends { position: Point }>(
  ranked: T[],
  separation_m: number,
  limit: number,
): T[] {
  const chosen: T[] = [];
  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    const apart = chosen.every(
      (taken) =>
        Math.hypot(entry.position[0] - taken.position[0], entry.position[1] - taken.position[1]) >=
        separation_m - TOLERANCE.coordinate_m,
    );
    if (apart) chosen.push(entry);
  }
  return chosen;
}

type Probe = { position: Point; rotation_deg: number; distance_m: number };

type Blocker = { polygon: Polygon; box: BoundingBox };

type VerifiedProbe = Probe & { object: Equipment; warnings: number; wallGap_m: number };

/**
 * Отрезки, которые для ранжирования считаются стеной.
 *
 * Стена — это сплошная её часть на высоте объекта: проём не стена, иначе
 * лучшим местом для стола оказался бы вход. Контур помещения берётся только
 * тогда, когда стен в плане нет вовсе, — у нарисованного с нуля плана стены
 * появляются вместе с контуром, а у собранного руками фрагмента могут и не
 * появиться, и тогда контур остаётся единственной границей зала.
 */
function wallEdgesFor(plan: PlanDocument, type: ObjectType): [Point, Point][] {
  const interval = intervalOf(type);
  const edges: [Point, Point][] = [];
  const collect = (polygon: Polygon): void => {
    for (let i = 0; i < polygon.length; i += 1) {
      edges.push([polygon[i]!, polygon[(i + 1) % polygon.length]!]);
    }
  };

  for (const wall of plan.walls) {
    for (const solid of wallObstacles(wall, plan.openings, interval)) collect(solid);
  }
  if (edges.length === 0) collect(plan.room.boundary);
  return edges;
}

/** Зазор от отпечатка до ближайшей стены; без стен — бесконечность. */
function wallGap(shape: Polygon, edges: [Point, Point][]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [from, to] of edges) {
    nearest = Math.min(nearest, polygonSegmentDistance(shape, from, to));
    if (nearest <= TOLERANCE.coordinate_m) return 0;
  }
  return nearest;
}

/** Числа с сетки 0,1 м: разница меньше допуска — это одно и то же место. */
function compareLengths(a: number, b: number): number {
  return Math.abs(a - b) <= TOLERANCE.coordinate_m ? 0 : a - b;
}


/**
 * Where a type is expected: the plan's own stocking rules plus the plan itself.
 *
 * A count rule with a minimum names a zone type where the type is expected, but
 * a minimum is not a ban elsewhere: zones where objects of the type already
 * stand in this plan are fitting too — the plan is data as much as the catalog.
 * Only types with such a rule are narrowed; without one the catalog says
 * nothing about zones and the whole room is searched.
 *
 * - `no-rule`: no count rule sets a minimum for the type — not narrowed;
 * - `off-floor`: the type does not occupy floor (camera, sensor, desk-top
 *   device) — it hangs or stands on something, zones do not narrow it;
 * - `no-zones`: the plan has no zones, so there is nothing to be out of place in;
 * - `override`: the user picked a zone of another type — their choice, reported;
 * - `missing`: the plan has no zone of a fitting type — nowhere to search;
 * - `narrowed`: candidates must resolve to one of `zoneIds`.
 *
 * The object's own zone is the deepest one that holds it: `inclusive` scope
 * decides what a rule *counts*, not where the object belongs — a queue nested
 * in the client hall is not a place for an operator's desk unless the plan
 * already has one there.
 */
export type ZoneFit = {
  mode: 'no-rule' | 'off-floor' | 'no-zones' | 'override' | 'missing' | 'narrowed';
  /** Fitting zone types, catalog order: from the rules and from the plan. */
  zoneTypeIds: Id[];
  /** The rules that name a zone type. */
  ruleIds: Id[];
  /** Zone types where objects of the type already stand in the plan. */
  placedZoneTypeIds: Id[];
  /** Zones a candidate may land in; null — the search is not narrowed. */
  zoneIds: Id[] | null;
};

export function zoneFit(plan: PlanDocument, typeId: Id, zoneId: Id | null): ZoneFit {
  const homes = plan.catalog.rules.filter(
    (rule): rule is Extract<Rule, { kind: 'count' }> =>
      rule.kind === 'count' && rule.objectTypeId === typeId && rule.min !== null,
  );
  const zoneTypeOf = new Map(plan.zones.map((zone) => [zone.id, zone.typeId]));
  const placed = new Set(
    plan.objects
      .filter((object) => object.typeId === typeId && object.zoneId !== null)
      .map((object) => zoneTypeOf.get(object.zoneId!))
      .filter((id): id is Id => id !== undefined),
  );
  const catalogOrder = plan.catalog.zoneTypes.map((zoneType) => zoneType.id);
  const placedZoneTypeIds = catalogOrder.filter((id) => placed.has(id));
  const zoneTypeIds = catalogOrder.filter(
    (id) => placed.has(id) || homes.some((rule) => rule.zoneTypeId === id),
  );
  const ruleIds = homes.map((rule) => rule.id);
  const open = (mode: ZoneFit['mode']): ZoneFit => ({
    mode,
    zoneTypeIds,
    ruleIds,
    placedZoneTypeIds,
    zoneIds: null,
  });

  if (homes.length === 0) return open('no-rule');
  const type = findObjectType(plan.catalog, typeId);
  if (type !== null && !type.occupiesFloor) return open('off-floor');
  if (plan.zones.length === 0) return open('no-zones');
  const chosen = zoneId === null ? null : plan.zones.find((zone) => zone.id === zoneId);
  if (chosen !== null && chosen !== undefined && !zoneTypeIds.includes(chosen.typeId)) {
    return open('override');
  }
  const zoneIds = plan.zones
    .filter((zone) => zoneTypeIds.includes(zone.typeId))
    .map((zone) => zone.id);
  return {
    mode: zoneIds.length === 0 ? 'missing' : 'narrowed',
    zoneTypeIds,
    ruleIds,
    placedZoneTypeIds,
    zoneIds,
  };
}

function issue(code: string, message: string, refs: Ref[]): Issue {
  return { code, severity: 'error', message, refs };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Centre of the outline's bounding box: the default anchor of a search. */
function outlineCentre(outline: Polygon): Point {
  const box = boundingBox(outline);
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
}

function intervalOf(type: ObjectType): HeightInterval {
  return { base_m: type.defaultBase_m, top_m: type.defaultBase_m + type.defaultHeight_m };
}

/**
 * What the object would run into at its own height. Objects the catalog does
 * not call physical are skipped, and so are the ones whose height band does not
 * meet the newcomer's — a camera under the ceiling blocks nothing on the floor.
 */
function blockersFor(plan: PlanDocument, type: ObjectType): Blocker[] {
  if (!type.physical) return [];
  const interval = intervalOf(type);
  const polygons: Polygon[] = [];

  for (const object of plan.objects) {
    const objectType = findObjectType(plan.catalog, object.typeId);
    // An unknown type is treated as solid, exactly as validation does.
    if (objectType !== null && !objectType.physical) continue;
    if (!intervalsOverlap(objectInterval(object), interval)) continue;
    polygons.push(footprint(object));
  }
  for (const wall of plan.walls) {
    polygons.push(...wallObstacles(wall, plan.openings, interval));
  }

  return polygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => ({ polygon, box: boundingBox(polygon) }));
}

/** A distance rule as a set of points the object must stay near. */
type Reach = { centres: Point[]; maxDistance_m: number };

/**
 * Rules that depend on *where* the object stands, so the sweep can obey them
 * instead of spending its budget on positions the check would reject anyway.
 * Only rules validation calls errors narrow the search: a team assumption may
 * rank candidates, never hide them. Count rules are not here — they depend on
 * how many objects there are, not on the position, and the full check catches
 * them on the finalists.
 */
function reachesFor(plan: PlanDocument, type: ObjectType): Reach[] {
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  return plan.catalog.rules
    .filter(
      (rule): rule is Extract<Rule, { kind: 'distance-to-entrance' }> =>
        rule.kind === 'distance-to-entrance' &&
        rule.objectTypeId === type.id &&
        rule.source === 'organizer-material',
    )
    .map((rule) => ({
      maxDistance_m: rule.maxDistance_m,
      centres: plan.openings
        .filter((opening) =>
          rule.entranceId === null
            ? opening.kind === 'entrance'
            : opening.id === rule.entranceId,
        )
        .flatMap((opening) => {
          const wall = walls.get(opening.wallId);
          return wall === undefined ? [] : [openingCentre(opening, wall)];
        }),
    }));
}

/** A plan with no entrance leaves such a rule unsatisfiable — and it must. */
function withinReach(position: Point, reaches: Reach[]): boolean {
  return reaches.every((reach) =>
    reach.centres.some((centre) => distance(position, centre) <= reach.maxDistance_m),
  );
}

/** A placement as it would sit in the plan, before its zone is resolved. */
function trialObject(
  id: Id,
  type: ObjectType,
  position: Point,
  rotation_deg: number,
  layerId: Id,
): Equipment {
  return {
    id,
    typeId: type.id,
    label: type.label,
    position,
    size_m: [type.defaultSize_m[0], type.defaultSize_m[1]],
    rotation_deg,
    base_m: type.defaultBase_m,
    height_m: type.defaultHeight_m,
    zoneId: null,
    layerId,
    attributes: defaultAttributes(type),
  };
}

function fits(
  shape: Polygon,
  room: Polygon,
  target: Polygon | null,
  blockers: Blocker[],
): boolean {
  if (!contains(room, shape)) return false;
  if (target !== null && !contains(target, shape)) return false;
  const box = boundingBox(shape);
  return !blockers.some(
    (blocker) => boxesOverlap(box, blocker.box) && intersects(shape, blocker.polygon),
  );
}

/**
 * Grid cells in rings around the anchor, nearest first, so a capped budget is
 * spent next to what the user pointed at instead of in the far corner. Ring
 * distance is Chebyshev; the exact Euclidean order is restored when candidates
 * are ranked.
 */
function* cellsAroundAnchor(box: BoundingBox, anchor: Point, step: number): Generator<Point> {
  const countX = Math.floor((box.maxX - box.minX) / step + TOLERANCE.coordinate_m) + 1;
  const countY = Math.floor((box.maxY - box.minY) / step + TOLERANCE.coordinate_m) + 1;
  if (countX <= 0 || countY <= 0) return;

  const at = (ix: number, iy: number): Point => [
    round6(box.minX + ix * step),
    round6(box.minY + iy * step),
  ];
  const clamp = (value: number, limit: number): number =>
    Math.min(Math.max(value, 0), limit - 1);
  const anchorX = clamp(Math.round((anchor[0] - box.minX) / step), countX);
  const anchorY = clamp(Math.round((anchor[1] - box.minY) / step), countY);
  const maxRing = Math.max(anchorX, countX - 1 - anchorX, anchorY, countY - 1 - anchorY);

  for (let ring = 0; ring <= maxRing; ring += 1) {
    const left = Math.max(anchorX - ring, 0);
    const right = Math.min(anchorX + ring, countX - 1);
    const bottom = anchorY - ring;
    const top = anchorY + ring;

    for (const iy of ring === 0 ? [bottom] : [bottom, top]) {
      if (iy < 0 || iy > countY - 1) continue;
      for (let ix = left; ix <= right; ix += 1) yield at(ix, iy);
    }
    if (ring === 0) continue;
    for (const ix of [anchorX - ring, anchorX + ring]) {
      if (ix < 0 || ix > countX - 1) continue;
      for (let iy = Math.max(bottom + 1, 0); iy <= Math.min(top - 1, countY - 1); iy += 1) {
        yield at(ix, iy);
      }
    }
  }
}

/** Identical floor shapes are one offer: a square turned 90° is the same square. */
function footprintKey(shape: Polygon): string {
  return shape
    .map((point) => `${round6(point[0])},${round6(point[1])}`)
    .sort()
    .join(';');
}

/**
 * Клетки вдоль стен: объект ставится вплотную к стене и едет по ней с тем же
 * шагом сетки, обеими сторонами (короткой и длинной).
 *
 * Зачем отдельный обход: кольцевой перебор от центра упирается в предел
 * `maxVerified` задолго до стен, и ранжировать у стены становится нечего —
 * список мест до неё просто не доходит. Порядок перебора ничего не разрешает
 * сам по себе: каждая клетка всё равно проходит `fits` и полную проверку.
 */
type HugGroup = { edges: [Point, Point][]; inside: Polygon };

/** Рёбра контура как отрезки, замкнуто. */
function outlineEdges(polygon: Polygon): [Point, Point][] {
  const edges: [Point, Point][] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    edges.push([polygon[i]!, polygon[(i + 1) % polygon.length]!]);
  }
  return edges;
}

/**
 * Клетки вдоль границ: объект прижимается к ребру и едет по нему с шагом
 * сетки, обеими своими сторонами.
 *
 * Границ две: сами стены и контур целевой зоны. Зона в настоящем плане
 * отступает от стены, и место вплотную к стене в неё уже не помещается —
 * тогда `fits` отбрасывает все места у стены, и перебор снова сваливается в
 * кольца от середины. Рёбра зоны дают ряд мест у её края, а какое из них
 * ближе к настоящей стене, решает ранг.
 *
 * Порядок ничего не разрешает сам по себе: каждая клетка по-прежнему проходит
 * `fits` и полную `validatePlan`.
 */
function* wallHugCells(type: ObjectType, groups: HugGroup[], step: number): Generator<Point> {
  const halfDepths = [type.defaultSize_m[1] / 2, type.defaultSize_m[0] / 2];
  for (const group of groups) {
    for (const [from, to] of group.edges) {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length <= TOLERANCE.coordinate_m) continue;
      const ux = (to[0] - from[0]) / length;
      const uy = (to[1] - from[1]) / length;
      const midX = from[0] + ux * (length / 2);
      const midY = from[1] + uy * (length / 2);

      for (const sign of [1, -1]) {
        const nx = -uy * sign;
        const ny = ux * sign;
        // Внутрь смотрит только одна сторона ребра: наружные грани стены и её
        // торцы отсеиваются здесь, а не проверкой геометрии на каждой клетке.
        const probe: Point = [midX + nx * step, midY + ny * step];
        if (locatePoint(probe, group.inside) !== 'inside') continue;

        for (const depth of halfDepths) {
          for (let along = 0; along <= length + TOLERANCE.coordinate_m; along += step) {
            yield [
              round6(from[0] + ux * along + nx * depth),
              round6(from[1] + uy * along + ny * depth),
            ];
          }
        }
      }
    }
  }
}

/** The grid only needs to cover the zones a candidate may land in. */
function searchBox(plan: PlanDocument, target: Polygon | null, allowed: Set<Id> | null): BoundingBox {
  if (target !== null || allowed === null) return boundingBox(target ?? plan.room.boundary);
  const boxes = plan.zones
    .filter((zone) => allowed.has(zone.id))
    .map((zone) => boundingBox(zone.polygon));
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

function sweep(
  plan: PlanDocument,
  type: ObjectType,
  target: Polygon | null,
  anchor: Point,
  layerId: Id,
  wallEdges: [Point, Point][] | null,
  allowed: Set<Id> | null,
): Probe[] {
  if (allowed !== null && allowed.size === 0) return [];
  const blockers = blockersFor(plan, type);
  const reaches = reachesFor(plan, type);
  const zoneIndex = prepareZones(plan.zones);
  const box = searchBox(plan, target, allowed);
  const allowedOutlines =
    allowed === null ? null : plan.zones.filter((zone) => allowed.has(zone.id)).map((zone) => zone.polygon);
  const separation = separationFor(type);
  const found: Probe[] = [];
  const seen = new Set<string>();
  let probes = 0;
  let visitedCells = 0;
  let domainCells = 0;

  const rings = cellsAroundAnchor(box, anchor, PLACEMENT_SEARCH.step_m);
  const order =
    wallEdges === null
      ? rings
      : (function* both() {
          yield* wallHugCells(
            type,
            [
              // Граница зоны идёт первой: зона отступает от стены, место
              // вплотную к стене в неё уже не помещается, и если сначала
              // пройти вдоль стен, то 24 подтверждаемых места закончатся на
              // этом отступе — до края зоны очередь не дойдёт. Когда зона
              // доходит до стены, обе границы совпадают и порядок ничего не
              // меняет.
              ...(target === null ? [] : [{ edges: outlineEdges(target), inside: target }]),
              { edges: wallEdges, inside: plan.room.boundary },
            ],
            PLACEMENT_SEARCH.step_m,
          );
          yield* rings;
        })();

  for (const position of order) {
    // The raw walk is bounded too: filtering a pathological polygon must not
    // turn the request into an arbitrarily long scan over its bounding box.
    if (visitedCells >= PLACEMENT_SEARCH.maxCells) return found;
    visitedCells += 1;
    // A centre outside every fitting zone cannot give a footprint inside one.
    // It is outside the search domain, so it must not spend the domain budget:
    // a large concave zone may have most of its bounding box outside itself.
    if (
      allowedOutlines !== null &&
      !allowedOutlines.some((outline) => locatePoint(position, outline) !== 'outside')
    ) {
      continue;
    }
    // Rejected cells inside the search domain still cost time. In particular
    // an unreachable entrance must not make the search walk forever.
    if (domainCells >= PLACEMENT_SEARCH.maxProbes) return found;
    domainCells += 1;
    if (!withinReach(position, reaches)) continue;
    // Места собираются разнесёнными: обход идёт кольцами от указанной точки,
    // поэтому соседние клетки подошли бы все подряд и бюджет ушёл бы на 24
    // варианта одной точки вместо 24 разных мест.
    if (!farEnough(position, found, separation)) continue;
    for (const rotation_deg of PLACEMENT_SEARCH.angles_deg) {
      if (probes >= PLACEMENT_SEARCH.maxProbes) return found;
      probes += 1;

      const trial = trialObject('probe', type, position, rotation_deg, layerId);
      const shape = footprint(trial);
      if (!fits(shape, plan.room.boundary, target, blockers)) continue;
      // Only after the cheap geometric test: a spot outside the zones where the
      // catalog expects this type is not offered at all.
      if (allowed !== null) {
        const home = resolveZone(trial, plan.zones, zoneIndex).zoneId;
        if (home === null || !allowed.has(home)) continue;
      }
      const key = footprintKey(shape);
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({ position, rotation_deg, distance_m: round6(distance(position, anchor)) });
      if (found.length >= PLACEMENT_SEARCH.maxVerified) return found;
      // Одно место — один вариант: другой поворот той же точки человеку
      // выбора не даёт, а проверку и показ занимает.
      break;
    }
  }
  return found;
}

/** Насколько разносить варианты для этого типа: длинная сторона, но не меньше предела. */
export function separationFor(type: ObjectType): number {
  return Math.max(
    type.defaultSize_m[0],
    type.defaultSize_m[1],
    PLACEMENT_SEARCH.minSeparation_m,
  );
}

function farEnough(position: Point, taken: { position: Point }[], separation_m: number): boolean {
  return taken.every(
    (entry) =>
      Math.hypot(position[0] - entry.position[0], position[1] - entry.position[1]) >=
      separation_m - TOLERANCE.coordinate_m,
  );
}

function issueKey(entry: Issue): string {
  return `${entry.code}|${entry.severity}|${entry.refs
    .map((ref) => `${ref.kind}:${ref.id}`)
    .join(',')}`;
}

function withObject(plan: PlanDocument, object: Equipment): PlanDocument {
  return { ...plan, objects: [...plan.objects, object] };
}

/**
 * The same check the editor runs, on the plan the user would get. Candidates
 * that would introduce an error are dropped; warnings — our own stocking rules —
 * are counted and rank the survivors.
 */
function verify(
  plan: PlanDocument,
  baseline: Set<string>,
  object: Equipment,
): number | null {
  const fresh = validatePlan(withObject(plan, object)).filter(
    (entry) => !baseline.has(issueKey(entry)),
  );
  if (fresh.some((entry) => entry.severity === 'error')) return null;
  return fresh.length;
}

/** Ids the plan already uses, so a reserved id cannot shadow a real one. */
function usedIds(plan: PlanDocument): Set<Id> {
  return new Set<Id>([
    plan.room.id,
    ...plan.walls.map((wall) => wall.id),
    ...plan.openings.map((opening) => opening.id),
    ...plan.layers.map((layer) => layer.id),
    ...plan.zones.map((zone) => zone.id),
    ...plan.objects.map((object) => object.id),
  ]);
}

function reserveId(taken: Set<Id>, prefix: string, index: number): Id {
  let id = `${prefix}_${index}`;
  let suffix = 0;
  while (taken.has(id)) {
    suffix += 1;
    id = `${prefix}_${index}_${suffix}`;
  }
  taken.add(id);
  return id;
}

function fact(
  id: Id,
  metric: Fact['metric'],
  phase: Fact['phase'],
  value: number,
  unit: Fact['unit'],
  refs: Ref[],
): Fact {
  return { id, metric, phase, value, unit, refs };
}

/**
 * Candidates for the requested type, best first. `ok: false` only when the
 * question cannot be answered at all — an unknown type, a missing zone, a
 * polygon with no area; "nowhere to put it" is an empty list, not an error.
 */
export const findPlacements: FindPlacements = (plan, request) => {
  const type = findObjectType(plan.catalog, request.typeId);
  if (type === null) {
    return {
      ok: false,
      issues: [
        issue(
          PLACEMENT_ISSUE_CODES.UNKNOWN_OBJECT_TYPE,
          `Тип объекта «${request.typeId}» отсутствует в справочнике плана.`,
          [],
        ),
      ],
    };
  }

  const zone =
    request.zoneId === null
      ? null
      : (plan.zones.find((candidate) => candidate.id === request.zoneId) ?? null);
  if (request.zoneId !== null && zone === null) {
    return {
      ok: false,
      issues: [
        issue(
          PLACEMENT_ISSUE_CODES.TARGET_ZONE_MISSING,
          `Зона «${request.zoneId}» отсутствует в плане.`,
          [{ kind: 'zone', id: request.zoneId }],
        ),
      ],
    };
  }

  // Areas are needed for the answer anyway, and they fail loudly on a polygon
  // that crosses itself — a sweep over such a plan would invent placements.
  const before = measurePlan(plan);
  if (!before.ok) return before;

  const layer = editableContentLayer(plan.layers);
  if (layer === undefined) {
    return {
      ok: false,
      issues: [
        issue(
          PLACEMENT_ISSUE_CODES.TARGET_LAYER_MISSING,
          'В плане нет незапертого обычного слоя: новый объект некуда положить.',
          [],
        ),
      ],
    };
  }

  const target = zone === null ? null : zone.polygon;
  const anchor = request.anchor ?? outlineCentre(target ?? plan.room.boundary);
  const wallEdges = wallEdgesFor(plan, type);
  const fit = zoneFit(plan, type.id, request.zoneId);
  const allowed = fit.zoneIds === null ? null : new Set(fit.zoneIds);
  const probes = sweep(
    plan,
    type,
    target,
    anchor,
    layer.id,
    request.anchor === undefined ? wallEdges : null,
    allowed,
  );

  const baseline = new Set(validatePlan(plan).map(issueKey));
  const taken = usedIds(plan);
  const zoneIndex = prepareZones(plan.zones);
  const verified: VerifiedProbe[] = [];
  for (const probe of probes) {
    const id = reserveId(taken, `adv_${type.id}`, verified.length + 1);
    const trial = trialObject(id, type, probe.position, probe.rotation_deg, layer.id);
    const object = { ...trial, zoneId: resolveZone(trial, plan.zones, zoneIndex).zoneId };
    const warnings = verify(plan, baseline, object);
    if (warnings === null) {
      taken.delete(id);
      continue;
    }
    verified.push({ ...probe, object, warnings, wallGap_m: wallGap(footprint(object), wallEdges) });
  }

  // Ranking: no new problems first, then — по обстановке — близость к стене или
  // к указанной точке, потом устойчивый геометрический порядок. Это читаемая
  // эвристика, а не оптимум.
  //
  // Точку указал человек — она и решает: он попросил место "вот здесь", и
  // отодвигать вариант к стене против его пальца нельзя. Точки нет — ассистент
  // сам подставил центр зоны, и тогда "ближе к центру" не довод: мебель в
  // отделении стоит по стенам, а середина зала нужна людям для прохода.
  const pinned = request.anchor !== undefined;
  verified.sort(
    (a, b) =>
      a.warnings - b.warnings ||
      (pinned
        ? compareLengths(a.distance_m, b.distance_m) || compareLengths(a.wallGap_m, b.wallGap_m)
        : compareLengths(a.wallGap_m, b.wallGap_m) || compareLengths(a.distance_m, b.distance_m)) ||
      a.position[0] - b.position[0] ||
      a.position[1] - b.position[1] ||
      a.rotation_deg - b.rotation_deg,
  );

  const roomRef: Ref = { kind: 'room', id: plan.room.id };
  const targetRef: Ref = zone === null ? roomRef : { kind: 'zone', id: zone.id };
  const currentCount = plan.objects.filter((object) => object.typeId === type.id).length;

  // Варианты разносятся по плану: см. PLACEMENT_SEARCH.minSeparation_m.
  const separation = Math.max(
    type.defaultSize_m[0],
    type.defaultSize_m[1],
    PLACEMENT_SEARCH.minSeparation_m,
  );

  const candidates: Candidate[] = [];
  for (const entry of spreadApart(verified, separation, PLACEMENT_SEARCH.maxCandidates)) {
    const after = measurePlan(withObject(plan, entry.object));
    if (!after.ok) continue;
    const id = entry.object.id;
    candidates.push({
      id,
      object: entry.object,
      facts: [
        fact(`${id}.placement.distance`, 'placement.distance', 'current', entry.distance_m, 'm', [
          targetRef,
        ]),
        fact(
          `${id}.area.free.current`,
          'area.free',
          'current',
          round6(before.value.room.free_m2),
          'm2',
          [roomRef],
        ),
        fact(
          `${id}.area.free.after`,
          'area.free',
          'after',
          round6(after.value.room.free_m2),
          'm2',
          [roomRef],
        ),
        fact(`${id}.equipment.count.current`, 'equipment.count', 'current', currentCount, 'count', [
          roomRef,
        ]),
        fact(`${id}.equipment.count.after`, 'equipment.count', 'after', currentCount + 1, 'count', [
          roomRef,
        ]),
      ],
    });
  }

  return { ok: true, value: candidates };
};
