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
import { findObjectType } from '../catalog';
import { objectOfType, takenIds } from '../commands';
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
  polygonArea,
  polygonSegmentDistance,
  wallObstacles,
  type BoundingBox,
  type HeightInterval,
} from '../geometry';
import { measurePlan } from '../metrics';
import { editableContentLayer } from '../content-layer';
import { prepareZones, resolveZone, type PreparedZones } from '../relations';
import { validatePlan } from '../validation';

/** Codes owned by this module. */
export const PLACEMENT_ISSUE_CODES = {
  /** The requested type is not in the plan's catalog. */
  UNKNOWN_OBJECT_TYPE: 'UNKNOWN_OBJECT_TYPE',
  /** The requested zone is not in the plan. */
  TARGET_ZONE_MISSING: 'TARGET_ZONE_MISSING',
  /** There is no ordinary unlocked layer that may own a new object. */
  TARGET_LAYER_MISSING: 'TARGET_LAYER_MISSING',
  /** #177: the object to move is not in the plan. */
  OBJECT_MISSING: 'OBJECT_MISSING',
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
 * #213: линия обслуживания для кассового окна и рабочего места оператора.
 *
 * Окно и стол оператора стоят у служебной стороны клиентского зала: у стены
 * или перегородки, за которой служебные помещения, лицом к клиентам. Линия —
 * общая граница зоны типа `clientZoneTypeId` с зоной служебного типа. Типы
 * берутся из каталога, конкретные зоны плана не называются. `zt_storage` здесь
 * потому, что «back_office» организаторов (`example_plan.json`) приходит как
 * зона хранения.
 *
 * Пороги — правило команды, не норматив Почты:
 * - `maxGap_m` — наибольший зазор от отпечатка до линии (граница зоны идёт по
 *   оси перегородки, половина её толщины входит в зазор);
 * - `entranceClearance_m` — ближе к центру входа место не предлагается: там
 *   проход. 3 м — тот же радиус «у входа», что у терминала очереди в
 *   `rule_queue_terminal_entrance`.
 *
 * Второй источник линии — ряд, который уже есть в плане: окна (рабочие места)
 * того же типа в клиентской зоне. Новый объект встаёт в их линию с их же
 * поворотом — вдоль длинной стороны стоящего объекта или по прямой через два
 * объекта с одним поворотом. В демо служебные перегородки заняты дверями, и
 * линия обслуживания там — ряд окон.
 *
 * Без точки от человека эти типы не встают у входа и на границе двух зон, а
 * места на линии идут первыми. Линии нет — места ищутся как раньше, с теми же
 * запретами.
 */
export const SERVICE_LINE = {
  objectTypeIds: ['ot_cashier_window', 'ot_workplace'],
  clientZoneTypeId: 'zt_client',
  serviceZoneTypeIds: ['zt_service', 'zt_staff', 'zt_storage'],
  maxGap_m: 0.5,
  entranceClearance_m: 3,
} as const;

/** Участок линии обслуживания; `inward` — единичная нормаль в клиентский зал. */
export type ServiceSegment = { from: Point; to: Point; inward: Point };

/** Общие участки границ клиентских и служебных зон, по `SERVICE_LINE`. */
export function serviceLineSegments(plan: PlanDocument): ServiceSegment[] {
  const serviceTypes: readonly Id[] = SERVICE_LINE.serviceZoneTypeIds;
  const clients = plan.zones.filter((zone) => zone.typeId === SERVICE_LINE.clientZoneTypeId);
  const services = plan.zones.filter((zone) => serviceTypes.includes(zone.typeId));
  const tolerance = TOLERANCE.coordinate_m;
  const segments: ServiceSegment[] = [];

  for (const client of clients) {
    for (const [a, b] of outlineEdges(client.polygon)) {
      const length = distance(a, b);
      if (length <= tolerance) continue;
      const ux = (b[0] - a[0]) / length;
      const uy = (b[1] - a[1]) / length;
      const along = (point: Point): number => (point[0] - a[0]) * ux + (point[1] - a[1]) * uy;
      const off = (point: Point): number => Math.abs((point[0] - a[0]) * uy - (point[1] - a[1]) * ux);
      const step = PLACEMENT_SEARCH.step_m;
      const mid: Point = [a[0] + ux * (length / 2), a[1] + uy * (length / 2)];
      const inward = ([[-uy, ux], [uy, -ux]] as Point[]).find(
        (normal) => locatePoint([mid[0] + normal[0] * step, mid[1] + normal[1] * step], client.polygon) === 'inside',
      );
      if (inward === undefined) continue;

      for (const service of services) {
        for (const [c, d] of outlineEdges(service.polygon)) {
          if (off(c) > tolerance || off(d) > tolerance) continue;
          const low = Math.max(0, Math.min(along(c), along(d)));
          const high = Math.min(length, Math.max(along(c), along(d)));
          if (high - low <= step) continue;
          segments.push({
            from: [round6(a[0] + ux * low), round6(a[1] + uy * low)],
            to: [round6(a[0] + ux * high), round6(a[1] + uy * high)],
            inward,
          });
        }
      }
    }
  }
  return segments;
}

/** Поворот, при котором лицевая сторона (локальная +Y: sin, cos) смотрит по `inward`. */
function facingRotation(inward: Point): number {
  const degrees = (Math.atan2(inward[0], inward[1]) * 180) / Math.PI;
  return round6(((degrees % 360) + 360) % 360);
}

/** Прямая ряда: точка на ней, единичное направление и поворот объектов ряда. */
type ServiceRow = { through: Point; axis: Point; rotation_deg: number };

/** Что нужно поиску для правила линии обслуживания. */
type ServiceLine = { segments: ServiceSegment[]; rows: ServiceRow[]; entrances: Point[] };

/**
 * Ряды из стоящих объектов типа в клиентских зонах: прямая через каждые два
 * объекта с одним поворотом, а у объекта без пары — ось его ширины. Одинаковые
 * прямые — один ряд.
 */
function serviceRows(plan: PlanDocument, typeId: Id): ServiceRow[] {
  const clientZones = new Set(
    plan.zones.filter((zone) => zone.typeId === SERVICE_LINE.clientZoneTypeId).map((zone) => zone.id),
  );
  const standing = plan.objects.filter(
    (object) => object.typeId === typeId && object.zoneId !== null && clientZones.has(object.zoneId),
  );
  const rows: ServiceRow[] = [];
  const seen = new Set<string>();
  const add = (through: Point, axis: Point, rotation_deg: number): void => {
    // Направление без знака и смещение прямой от начала координат — ключ прямой.
    const flip = axis[0] < -TOLERANCE.coordinate_m || (Math.abs(axis[0]) <= TOLERANCE.coordinate_m && axis[1] < 0);
    const unit: Point = flip ? [-axis[0], -axis[1]] : axis;
    const offset = through[0] * unit[1] - through[1] * unit[0];
    const key = `${rotation_deg}|${round6(unit[0]).toFixed(3)}|${round6(unit[1]).toFixed(3)}|${offset.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ through, axis: unit, rotation_deg });
  };
  for (const object of standing) {
    // Ряд из двух и больше объектов с одним поворотом задаёт прямая через них:
    // окна в example_plan.json стоят друг за другом поперёк своей ширины.
    if (standing.some((other) => other !== object && other.rotation_deg === object.rotation_deg)) continue;
    const angle = (object.rotation_deg * Math.PI) / 180;
    // Локальная +X после поворота по часовой стрелке: (cos, −sin).
    add(object.position, [Math.cos(angle), -Math.sin(angle)], object.rotation_deg);
  }
  for (let i = 0; i < standing.length; i += 1) {
    for (let j = i + 1; j < standing.length; j += 1) {
      const a = standing[i]!;
      const b = standing[j]!;
      if (a.rotation_deg !== b.rotation_deg) continue;
      const length = distance(a.position, b.position);
      if (length <= TOLERANCE.coordinate_m) continue;
      add(a.position, [(b.position[0] - a.position[0]) / length, (b.position[1] - a.position[1]) / length], a.rotation_deg);
    }
  }
  return rows;
}

/** Клетки по прямой ряда, от стоящего объекта в обе стороны, ближние первыми. */
function* serviceRowCells(rows: ServiceRow[], room: BoundingBox, step: number): Generator<Cell> {
  const reach = Math.hypot(room.maxX - room.minX, room.maxY - room.minY);
  for (const row of rows) {
    const rotations = [row.rotation_deg];
    for (let k = 1; k * step <= reach + TOLERANCE.coordinate_m; k += 1) {
      for (const sign of [1, -1]) {
        const position: Point = [
          round6(row.through[0] + row.axis[0] * k * step * sign),
          round6(row.through[1] + row.axis[1] * k * step * sign),
        ];
        if (position[0] < room.minX || position[0] > room.maxX || position[1] < room.minY || position[1] > room.maxY) continue;
        yield { position, rotations, onLine: true };
      }
    }
  }
}

/** Центры всех входов плана. */
function entranceCentres(plan: PlanDocument): Point[] {
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  return plan.openings
    .filter((opening) => opening.kind === 'entrance')
    .flatMap((opening) => {
      const wall = walls.get(opening.wallId);
      return wall === undefined ? [] : [openingCentre(opening, wall)];
    });
}

/** #237: от центра места до центра ближайшего входа; входов нет — null. */
function nearestEntrance(position: Point, entrances: Point[]): number | null {
  return entrances.length === 0 ? null : round6(Math.min(...entrances.map((centre) => distance(position, centre))));
}

function serviceLineFor(plan: PlanDocument, type: ObjectType): ServiceLine | null {
  const types: readonly Id[] = SERVICE_LINE.objectTypeIds;
  if (!types.includes(type.id)) return null;
  return { segments: serviceLineSegments(plan), rows: serviceRows(plan, type.id), entrances: entranceCentres(plan) };
}

/** Отпечаток ближе `entranceClearance_m` к центру входа — это проход. */
function inEntrancePassage(shape: Polygon, entrances: Point[]): boolean {
  return entrances.some(
    (centre) =>
      polygonSegmentDistance(shape, centre, centre) <
      SERVICE_LINE.entranceClearance_m - TOLERANCE.coordinate_m,
  );
}

/** Отпечаток заходит в зону, которая не его зона и не её родитель: стоит на границе двух зон. */
function straddlesZones(plan: PlanDocument, shape: Polygon, home: Id | null): boolean {
  const parents = new Map(plan.zones.map((zone) => [zone.id, zone.parentId]));
  const chain = new Set<Id>();
  for (let current = home; current !== null && !chain.has(current); current = parents.get(current) ?? null) {
    chain.add(current);
  }
  return plan.zones.some((zone) => !chain.has(zone.id) && intersects(shape, zone.polygon));
}

/**
 * Клетки вдоль линии обслуживания: длинная сторона вдоль линии, лицом в зал,
 * рядами от линии до `maxGap_m`. Ряд у самой границы обычно упирается в
 * перегородку — `fits` его отбросит, и место встанет следующим рядом.
 */
function* serviceLineCells(type: ObjectType, segments: ServiceSegment[], step: number): Generator<Cell> {
  const [width, depth] = type.defaultSize_m;
  for (let gap = 0; gap <= SERVICE_LINE.maxGap_m + TOLERANCE.coordinate_m; gap += step) {
    for (const segment of segments) {
      const length = distance(segment.from, segment.to);
      if (length + TOLERANCE.coordinate_m < width) continue;
      const ux = (segment.to[0] - segment.from[0]) / length;
      const uy = (segment.to[1] - segment.from[1]) / length;
      const offset = depth / 2 + gap;
      const rotations = [facingRotation(segment.inward)];
      for (let along = width / 2; along <= length - width / 2 + TOLERANCE.coordinate_m; along += step) {
        yield {
          position: [
            round6(segment.from[0] + ux * along + segment.inward[0] * offset),
            round6(segment.from[1] + uy * along + segment.inward[1] * offset),
          ],
          rotations,
          onLine: true,
        };
      }
    }
  }
}

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

type Probe = { position: Point; rotation_deg: number; distance_m: number; onLine: boolean };

/** Клетка обхода: центр, допустимые повороты и признак «у линии обслуживания». */
type Cell = { position: Point; rotations: readonly number[]; onLine: boolean };

type Blocker = { polygon: Polygon; box: BoundingBox };

type VerifiedProbe = Probe & { object: Equipment; warnings: number; wallGap_m: number; entrance_m: number | null };

/**
 * Отрезки, которые для ранжирования считаются стеной.
 *
 * Стена — это сплошная её часть на высоте объекта: проём не стена, иначе
 * лучшим местом для стола оказался бы вход. Контур помещения берётся только
 * тогда, когда стен в плане нет вовсе, — у нарисованного с нуля плана стены
 * появляются вместе с контуром, а у собранного руками фрагмента могут и не
 * появиться, и тогда контур остаётся единственной границей зала.
 */
export function wallEdgesFor(plan: PlanDocument, type: ObjectType): [Point, Point][] {
  const interval = intervalOf(type);
  const edges: [Point, Point][] = [];
  const collect = (polygon: Polygon): void => {
    for (let i = 0; i < polygon.length; i += 1) {
      edges.push([polygon[i]!, polygon[(i + 1) % polygon.length]!]);
    }
  };

  for (const wall of plan.walls) {
    for (const solid of wallObstacles(wall, plan.openings, interval, plan.walls)) collect(solid);
  }
  if (edges.length === 0) collect(plan.room.boundary);
  return edges;
}

/** Зазор от отпечатка до ближайшей стены; без стен — бесконечность. */
export function wallGap(shape: Polygon, edges: [Point, Point][]): number {
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

/**
 * #237: порядок поиска по уместным зонам. Без зоны и без точки от человека
 * сначала ищем в зонах типа из правил комплектования, и только если там места
 * нет — во всех уместных зонах, то есть и там, где такой тип уже стоит. Иначе
 * скамья из зоны ожидания уходила в комнату персонала: там тоже стоит скамья,
 * и место у стены там нашлось раньше.
 */
export function zoneTiers(plan: PlanDocument, fit: ZoneFit, free: boolean): (Set<Id> | null)[] {
  if (fit.zoneIds === null) return [null];
  const all = new Set(fit.zoneIds);
  if (!free) return [all];
  const ruleZoneTypes = new Set(
    plan.catalog.rules.flatMap((rule) => (rule.kind === 'count' && fit.ruleIds.includes(rule.id) ? [rule.zoneTypeId] : [])),
  );
  const first = new Set(plan.zones.filter((zone) => all.has(zone.id) && ruleZoneTypes.has(zone.typeId)).map((zone) => zone.id));
  return first.size === 0 || first.size === all.size ? [all] : [first, all];
}

/**
 * The deepest zone the object's centre lies strictly inside. The inventory
 * zone (`zoneId`) needs the whole footprint inside; a spot that pokes 0.1 m out
 * of a nested waiting area still stands in that area for a person — so fit and
 * the label are judged by the centre. Equal depth — the smaller zone wins.
 */
export function centreZoneId(
  plan: PlanDocument,
  position: Point,
  prepared: PreparedZones = prepareZones(plan.zones),
): Id | null {
  let best: { id: Id; depth: number; area: number } | null = null;
  for (const entry of prepared.usable) {
    if (locatePoint(position, entry.zone.polygon) !== 'inside') continue;
    const area = polygonArea(entry.zone.polygon);
    if (best === null || entry.depth > best.depth || (entry.depth === best.depth && area < best.area)) {
      best = { id: entry.zone.id, depth: entry.depth, area };
    }
  }
  return best?.id ?? null;
}

/**
 * Zones from the object's inventory zone down to the zone under its centre:
 * `[z_hall, z_waiting]` reads «Клиентский зал → Зона ожидания». One entry when
 * both are the same; empty when the object is outside every zone.
 */
export function placementZonePath(plan: PlanDocument, object: Equipment): Id[] {
  const centre = centreZoneId(plan, object.position);
  if (centre === null || centre === object.zoneId) return object.zoneId === null ? [] : [object.zoneId];
  const parents = new Map(plan.zones.map((zone) => [zone.id, zone.parentId]));
  const chain: Id[] = [];
  let current: Id | null | undefined = centre;
  while (current !== null && current !== undefined && !chain.includes(current)) {
    chain.unshift(current);
    if (current === object.zoneId) return chain;
    current = parents.get(current);
  }
  return object.zoneId === null ? [centre] : [object.zoneId, centre];
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
    polygons.push(...wallObstacles(wall, plan.openings, interval, plan.walls));
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
  line: ServiceLine | null,
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

  const grid = (points: Iterable<Point>): Generator<Cell> =>
    (function* cells() {
      for (const position of points) yield { position, rotations: PLACEMENT_SEARCH.angles_deg, onLine: false };
    })();
  const rings = grid(cellsAroundAnchor(box, anchor, PLACEMENT_SEARCH.step_m));
  const order =
    wallEdges === null
      ? rings
      : (function* both() {
          // #213: места у линии обслуживания — первыми, но не больше половины
          // бюджета, чтобы при занятой линии осталось из чего выбрать.
          if (line !== null) {
            yield* serviceRowCells(line.rows, boundingBox(plan.room.boundary), PLACEMENT_SEARCH.step_m);
            yield* serviceLineCells(type, line.segments, PLACEMENT_SEARCH.step_m);
          }
          yield* grid(wallHugCells(
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
          ));
          yield* rings;
        })();
  const lineBudget = Math.floor(PLACEMENT_SEARCH.maxVerified / 2);

  for (const { position, rotations, onLine } of order) {
    if (onLine && found.length >= lineBudget) continue;
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
    for (const rotation_deg of rotations) {
      if (probes >= PLACEMENT_SEARCH.maxProbes) return found;
      probes += 1;

      const trial = objectOfType(type, { id: 'probe', position, rotation_deg, layerId });
      const shape = footprint(trial);
      if (!fits(shape, plan.room.boundary, target, blockers)) continue;
      // Only after the cheap geometric test: a spot outside the zones where the
      // catalog expects this type is not offered at all.
      if (allowed !== null) {
        const home = resolveZone(trial, plan.zones, zoneIndex).zoneId;
        if (home === null || !allowed.has(home)) continue;
        // A window whose footprint is in the hall but whose centre is in the
        // nested waiting area stands in the waiting area: judged there.
        const centre = centreZoneId(plan, position, zoneIndex);
        if (centre !== null && !allowed.has(centre)) continue;
      }
      // #213: окно и рабочее место — не в проходе у входа и не на границе зон.
      if (line !== null) {
        if (inEntrancePassage(shape, line.entrances)) continue;
        if (straddlesZones(plan, shape, resolveZone(trial, plan.zones, zoneIndex).zoneId)) continue;
      }
      const key = footprintKey(shape);
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({ position, rotation_deg, distance_m: round6(distance(position, anchor)), onLine });
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

export function issueKey(entry: Issue): string {
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
export function verify(
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

export function reserveId(taken: Set<Id>, prefix: string, index: number): Id {
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
export const findPlacements: FindPlacements = (plan, request) => searchPlacements(plan, request);

/**
 * #177: spots nearer than `minSeparation_m` to `avoid` (the object's own spot) are «оставить как есть».
 * #237: `nearEntrance` — человек просит «ближе к входу»: варианты идут по расстоянию до входа.
 */
export function searchPlacements(
  plan: PlanDocument,
  request: Parameters<FindPlacements>[1],
  avoid: Point | null = null,
  nearEntrance = false,
): ReturnType<FindPlacements> {
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
  // Точку указал человек — правило линии её не переспоривает.
  const line = request.anchor === undefined ? serviceLineFor(plan, type) : null;
  const entrances = entranceCentres(plan);
  const baseline = new Set(validatePlan(plan).map(issueKey));
  const taken = takenIds(plan);
  const zoneIndex = prepareZones(plan.zones);
  const verified: VerifiedProbe[] = [];
  for (const allowed of zoneTiers(plan, fit, request.zoneId === null && request.anchor === undefined)) {
    const probes = sweep(
      plan,
      type,
      target,
      anchor,
      layer.id,
      request.anchor === undefined ? wallEdges : null,
      allowed,
      line,
    );
    for (const probe of probes) {
      const id = reserveId(taken, `adv_${type.id}`, verified.length + 1);
      const trial = objectOfType(type, { id, position: probe.position, rotation_deg: probe.rotation_deg, layerId: layer.id });
      const object = { ...trial, zoneId: resolveZone(trial, plan.zones, zoneIndex).zoneId };
      const warnings = verify(plan, baseline, object);
      if (warnings === null) {
        taken.delete(id);
        continue;
      }
      verified.push({
        ...probe,
        object,
        warnings,
        wallGap_m: wallGap(footprint(object), wallEdges),
        entrance_m: nearestEntrance(probe.position, entrances),
      });
    }
    if (verified.length > 0) break;
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
      // #213: у линии обслуживания — раньше остальных (только окно и рабочее место).
      Number(b.onLine) - Number(a.onLine) ||
      // #237: «ближе к входу» — по расстоянию до ближайшего входа.
      (nearEntrance ? compareLengths(a.entrance_m ?? 0, b.entrance_m ?? 0) : 0) ||
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
  const apart = avoid === null ? verified : verified.filter((entry) => distance(entry.position, avoid) >= PLACEMENT_SEARCH.minSeparation_m - TOLERANCE.coordinate_m);
  for (const entry of spreadApart(apart, separation, PLACEMENT_SEARCH.maxCandidates)) {
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
        // #237: расстояние от центра варианта до центра ближайшего входа.
        ...(entry.entrance_m === null
          ? []
          : [fact(`${id}.layout.entrance.after`, 'layout.entrance', 'after', entry.entrance_m, 'm', [roomRef])]),
      ],
    });
  }

  return { ok: true, value: candidates };
}
