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
  wallObstacles,
  type BoundingBox,
  type HeightInterval,
} from '../geometry';
import { measurePlan } from '../metrics';
import { resolveZone } from '../relations';
import { validatePlan } from '../validation';

/** Codes owned by this module. */
export const PLACEMENT_ISSUE_CODES = {
  /** The requested type is not in the plan's catalog. */
  UNKNOWN_OBJECT_TYPE: 'UNKNOWN_OBJECT_TYPE',
  /** The requested zone is not in the plan. */
  TARGET_ZONE_MISSING: 'TARGET_ZONE_MISSING',
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
  /** Upper bound on geometric probes, so a large hall still answers. */
  maxProbes: 60_000,
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

type VerifiedProbe = Probe & { object: Equipment; warnings: number };

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

function sweep(
  plan: PlanDocument,
  type: ObjectType,
  target: Polygon | null,
  anchor: Point,
  layerId: Id,
): Probe[] {
  const blockers = blockersFor(plan, type);
  const reaches = reachesFor(plan, type);
  const outline = target ?? plan.room.boundary;
  const box = boundingBox(outline);
  const separation = separationFor(type);
  const found: Probe[] = [];
  const seen = new Set<string>();
  let probes = 0;
  let cells = 0;

  for (const position of cellsAroundAnchor(box, anchor, PLACEMENT_SEARCH.step_m)) {
    // Rejected cells still cost time. In particular an unreachable entrance
    // must not make the search walk an arbitrarily large grid without a limit.
    if (cells >= PLACEMENT_SEARCH.maxProbes) return found;
    cells += 1;
    if (!withinReach(position, reaches)) continue;
    // Места собираются разнесёнными: обход идёт кольцами от указанной точки,
    // поэтому соседние клетки подошли бы все подряд и бюджет ушёл бы на 24
    // варианта одной точки вместо 24 разных мест.
    if (!farEnough(position, found, separation)) continue;
    for (const rotation_deg of PLACEMENT_SEARCH.angles_deg) {
      if (probes >= PLACEMENT_SEARCH.maxProbes) return found;
      probes += 1;

      const shape = footprint(trialObject('probe', type, position, rotation_deg, layerId));
      if (!fits(shape, plan.room.boundary, target, blockers)) continue;
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

  const layer = plan.layers.find((entry) => !entry.locked) ?? plan.layers[0];
  if (layer === undefined) {
    return {
      ok: false,
      issues: [
        issue(
          PLACEMENT_ISSUE_CODES.TARGET_ZONE_MISSING,
          'В плане нет ни одного слоя: новый объект некуда положить.',
          [],
        ),
      ],
    };
  }

  const target = zone === null ? null : zone.polygon;
  const anchor = request.anchor ?? outlineCentre(target ?? plan.room.boundary);
  const probes = sweep(plan, type, target, anchor, layer.id);

  const baseline = new Set(validatePlan(plan).map(issueKey));
  const taken = usedIds(plan);
  const verified: VerifiedProbe[] = [];
  for (const probe of probes) {
    const id = reserveId(taken, `adv_${type.id}`, verified.length + 1);
    const trial = trialObject(id, type, probe.position, probe.rotation_deg, layer.id);
    const object = { ...trial, zoneId: resolveZone(trial, plan.zones).zoneId };
    const warnings = verify(plan, baseline, object);
    if (warnings === null) {
      taken.delete(id);
      continue;
    }
    verified.push({ ...probe, object, warnings });
  }

  // Ranking: no new problems first, then closeness to what the user pointed at,
  // then a stable geometric order. This is a readable heuristic, not optimality.
  verified.sort(
    (a, b) =>
      a.warnings - b.warnings ||
      a.distance_m - b.distance_m ||
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
