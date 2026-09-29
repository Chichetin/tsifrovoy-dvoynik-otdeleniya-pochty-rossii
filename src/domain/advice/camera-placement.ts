/**
 * Issue #32: where to hang a camera so that it closes a blind spot.
 *
 * The same `place` recommendation as any other placement — candidates with the
 * contract facts (free area and count, before and after) and a reason code
 * from the frozen dictionary — but the variants are chosen by coverage, not by
 * free floor: the blind spot is the largest connected patch of client-zone
 * squares no camera sees (D-306 grid), and every candidate point and heading
 * is scored by how many of its squares the new camera would see. The effect in
 * percent («было → стало») is computed by `cameraCoverage` on the plan with the
 * candidate, here for the recommendation's text and in `agent-facts` for the
 * chat — never by the model.
 *
 * Nothing here decides whether the plan needs a camera: that is the person's
 * question. A plan with no client zones, no blind spot, or a zone that is not
 * a client zone gets the ordinary placement search instead (`null`).
 */

import type { Candidate, Fact, Recommendation } from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import type { Equipment, Id, PlanDocument, Point, Ref, Result } from '../../contracts/model';
import { findObjectType, defaultAttributes, rulesForObjectType } from '../catalog';
import { editableContentLayer } from '../content-layer';
import { boundingBox, locatePoint, viewSectorTest, type BoundingBox } from '../geometry';
import { measurePlan } from '../metrics';
import { formatShort } from '../number-format';
import { prepareZones, resolveZone } from '../relations';
import { validatePlan } from '../validation';
import {
  COVERAGE_GRID,
  cameraCoverage,
  clientZones,
  fieldRepresentationFor,
  isClientZone,
  type CameraCoverage,
  type CameraFieldRepresentation,
} from './camera-coverage';
import { issueKey, reserveId, spreadApart, trialObject, usedIds, verify } from './placement';

export const CAMERA_SEARCH = {
  /** Candidate points: a grid of this step inside the client zones, metres. */
  step_m: 0.5,
  /** Candidate headings, degrees clockwise from +Y. */
  headingStep_deg: 15,
  /** Sector tests allowed in one search; a larger spot or plan gets a coarser point grid (0,5 → 1 → 2 м…). */
  maxTests: 2_000_000,
  /** Squares of the spot a variant is scored on, at most; a larger spot is sampled evenly. */
  maxPatchSample: 2_000,
  /** Variants are at least this far apart, metres. */
  minSeparation_m: 1,
  maxCandidates: 3,
} as const;

type Cell = { ix: number; iy: number };

/** Blind squares of the scope, as grid indices. */
function blindCells(coverage: CameraCoverage, scope: (point: Point) => boolean): Cell[] {
  const cell = coverage.cell_m;
  const cells: Cell[] = [];
  for (const strip of coverage.blind) {
    const iy = Math.round(strip.y / cell);
    const from = Math.round(strip.x / cell);
    const count = Math.round(strip.width / cell);
    for (let ix = from; ix < from + count; ix += 1) {
      if (scope([(ix + 0.5) * cell, (iy + 0.5) * cell])) cells.push({ ix, iy });
    }
  }
  return cells;
}

/** The largest 4-connected patch; on a tie, the one met first in row order. */
function largestPatch(cells: readonly Cell[]): Cell[] {
  // Numeric keys: a big plan has tens of thousands of blind squares.
  const key = (ix: number, iy: number): number => (iy + 1_000_000) * 2_000_003 + (ix + 1_000_000);
  const left = new Map(cells.map((entry) => [key(entry.ix, entry.iy), entry]));
  let best: Cell[] = [];
  for (const start of cells) {
    if (!left.has(key(start.ix, start.iy))) continue;
    const patch: Cell[] = [];
    const queue = [start];
    left.delete(key(start.ix, start.iy));
    while (queue.length > 0) {
      const current = queue.pop()!;
      patch.push(current);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = left.get(key(current.ix + dx, current.iy + dy));
        if (next === undefined) continue;
        left.delete(key(next.ix, next.iy));
        queue.push(next);
      }
    }
    if (patch.length > best.length) best = patch;
  }
  return best;
}

function numberAttribute(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `distance_m` — to the middle of the blind spot: ranks equal gains, nearer first. */
type Probe = { position: Point; rotation_deg: number; gain: number; distance_m: number };

function percentText(value: number | null): string {
  return value === null ? '—' : `${formatShort(value)} %`;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function fact(id: Id, metric: Fact['metric'], phase: Fact['phase'], value: number, unit: Fact['unit'], refs: Ref[]): Fact {
  return { id, metric, phase, value, unit, refs };
}

/** Coverage of the plan's client zones with one more object in it. */
export function coverageWith(
  plan: PlanDocument,
  representation: CameraFieldRepresentation,
  object: Equipment | null,
): CameraCoverage {
  return cameraCoverage(object === null ? plan : { ...plan, objects: [...plan.objects, object] }, representation);
}

/** Coverage of the client zones without and with a candidate camera: the «было → стало» of #32. */
export type CameraEffect = { before: CameraCoverage; after: CameraCoverage };

/**
 * The effect of a placement candidate on camera coverage, or `null` when the
 * candidate is not a sector type or the plan has no client zones. Recomputed
 * from the plan and the candidate — the chat and the fallback text never take
 * a percentage from anywhere else.
 */
export function cameraCandidateEffect(plan: PlanDocument, candidate: Pick<Candidate, 'object'>): CameraEffect | null {
  const cached = effects.get(plan)?.get(candidate.object);
  if (cached !== undefined) return cached;
  const representation = fieldRepresentationFor(plan.catalog, candidate.object.typeId);
  const effect =
    representation === null || clientZones(plan).length === 0
      ? null
      : { before: baseCoverage(plan, representation), after: coverageWith(plan, representation, candidate.object) };
  const byObject = effects.get(plan) ?? new WeakMap<Equipment, CameraEffect | null>();
  byObject.set(candidate.object, effect);
  effects.set(plan, byObject);
  return effect;
}

/**
 * The agent collects facts after every tool call, the fallback text asks
 * again: the plan and the candidate objects of one exchange are the same
 * objects each time, so their coverage is counted once. Documents are
 * immutable (a change is a new object), so identity is a safe key.
 */
const effects = new WeakMap<PlanDocument, WeakMap<Equipment, CameraEffect | null>>();
const bases = new WeakMap<PlanDocument, Map<CameraFieldRepresentation, CameraCoverage>>();

function baseCoverage(plan: PlanDocument, representation: CameraFieldRepresentation): CameraCoverage {
  const byRepresentation = bases.get(plan) ?? new Map<CameraFieldRepresentation, CameraCoverage>();
  const known = byRepresentation.get(representation);
  if (known !== undefined) return known;
  const coverage = cameraCoverage(plan, representation);
  byRepresentation.set(representation, coverage);
  bases.set(plan, byRepresentation);
  return coverage;
}

/**
 * The coverage-driven placement of a sector type, or `null` when it does not
 * apply and the ordinary search should answer.
 */
export function cameraPlacementAdvice(
  plan: PlanDocument,
  request: { typeId: Id; zoneId: Id | null },
): Result<Recommendation[]> | null {
  const representation = fieldRepresentationFor(plan.catalog, request.typeId);
  const type = findObjectType(plan.catalog, request.typeId);
  if (representation === null || type === null) return null;
  const clients = clientZones(plan);
  if (clients.length === 0) return null;
  const zone = request.zoneId === null ? null : plan.zones.find((entry) => entry.id === request.zoneId);
  if (zone === undefined || (zone !== null && !isClientZone(plan, zone))) return null;
  const layer = editableContentLayer(plan.layers);
  if (layer === undefined) return null;

  const before = baseCoverage(plan, representation);
  const scopeZones = zone === null ? clients : [zone];
  // Every blind square is in some client zone already: only a chosen zone narrows the scope.
  const inScope = (point: Point): boolean =>
    zone === null || locatePoint(point, zone.polygon) !== 'outside';
  const patch = largestPatch(blindCells(before, inScope));
  if (patch.length === 0) return null;

  const measured = measurePlan(plan);
  if (!measured.ok) return measured;

  const cell = COVERAGE_GRID.cell_m;
  const centres: Point[] = patch.map((entry) => [(entry.ix + 0.5) * cell, (entry.iy + 0.5) * cell]);
  const patchBox = boundingBox(centres);
  const patchZoneIds = scopeZones
    .filter((entry) => centres.some((centre) => locatePoint(centre, entry.polygon) !== 'outside'))
    .map((entry) => entry.id);

  // The new camera looks as its type says; the layer's defaults fill the gaps.
  const attributes = defaultAttributes(type);
  const angle = numberAttribute(attributes[representation.angleAttribute]) ?? representation.angle_deg;
  const range = numberAttribute(attributes[representation.rangeAttribute]) ?? representation.range_m;

  const { probes, step_m } = searchProbes(scopeZones.map((entry) => entry.polygon), centres, patchBox, angle, range);
  const baseline = new Set(validatePlan(plan).map(issueKey));
  const taken = usedIds(plan);
  const zoneIndex = prepareZones(plan.zones);
  const verified: (Probe & { object: Equipment })[] = [];
  for (const probe of probes) {
    if (verified.length >= CAMERA_SEARCH.maxCandidates) break;
    // Variants differ visibly: the best point, then the best one a metre away, and so on.
    if (spreadApart([...verified, probe], CAMERA_SEARCH.minSeparation_m, verified.length + 1).length <= verified.length) continue;
    const id = reserveId(taken, `adv_${type.id}`, verified.length + 1);
    const trial = cameraObject(trialObject(id, type, probe.position, probe.rotation_deg, layer.id), representation, angle, range);
    const object = { ...trial, zoneId: resolveZone(trial, plan.zones, zoneIndex).zoneId };
    if (verify(plan, baseline, object) === null) {
      taken.delete(id);
      continue;
    }
    verified.push({ ...probe, object });
  }

  const roomRef: Ref = { kind: 'room', id: plan.room.id };
  const targetRef: Ref = zone === null ? roomRef : { kind: 'zone', id: zone.id };
  // `placement.distance` means the same as in the ordinary search: from the
  // candidate to the middle of the target zone's (or the room's) bounding box.
  const targetBox = boundingBox(zone === null ? plan.room.boundary : zone.polygon);
  const targetMiddle: Point = [(targetBox.minX + targetBox.maxX) / 2, (targetBox.minY + targetBox.maxY) / 2];
  const recommendationId = `adv_place_${type.id}_${zone?.id ?? plan.room.id}`;
  const currentCount = plan.objects.filter((object) => object.typeId === type.id).length;
  const chosen = verified;
  const candidates: Candidate[] = [];
  const effects: string[] = [];
  for (const [index, entry] of chosen.entries()) {
    // An object that does not occupy floor leaves the areas as they are (measurePlan
    // counts only floor objects); measuring the whole plan again costs ~0,8 s at 1 000 objects.
    const afterArea = type.occupiesFloor ? measurePlan({ ...plan, objects: [...plan.objects, entry.object] }) : measured;
    if (!afterArea.ok) continue;
    const id = entry.object.id;
    candidates.push({
      id,
      object: entry.object,
      facts: [
        fact(
          `${id}.placement.distance`,
          'placement.distance',
          'current',
          round6(Math.hypot(entry.position[0] - targetMiddle[0], entry.position[1] - targetMiddle[1])),
          'm',
          [targetRef],
        ),
        fact(`${id}.area.free.current`, 'area.free', 'current', round6(measured.value.room.free_m2), 'm2', [roomRef]),
        fact(`${id}.area.free.after`, 'area.free', 'after', round6(afterArea.value.room.free_m2), 'm2', [roomRef]),
        fact(`${id}.equipment.count.current`, 'equipment.count', 'current', currentCount, 'count', [roomRef]),
        fact(`${id}.equipment.count.after`, 'equipment.count', 'after', currentCount + 1, 'count', [roomRef]),
      ],
    });
    const after = coverageWith(plan, representation, entry.object);
    effects.push(`вариант ${index + 1} — ${percentText(after.total.percent)}`);
  }

  const cameraIds = [...new Set(before.zones.flatMap((entry) => entry.cameraIds))];
  const refs: Ref[] = [targetRef];
  for (const zoneId of [...patchZoneIds, ...candidates.flatMap((entry) => (entry.object.zoneId === null ? [] : [entry.object.zoneId]))]) {
    if (!refs.some((ref) => ref.kind === 'zone' && ref.id === zoneId)) refs.push({ kind: 'zone', id: zoneId });
  }
  for (const cameraId of cameraIds) refs.push({ kind: 'object', id: cameraId });

  const zoneNames = patchZoneIds
    .map((zoneId) => `«${plan.zones.find((entry) => entry.id === zoneId)?.name ?? zoneId}» (${zoneId})`)
    .join(', ');
  const reasonCode = candidates.length > 0 ? 'placement.available' : 'placement.none';
  const recommendation: Recommendation = {
    id: recommendationId,
    scenario: 'place',
    refs,
    candidates,
    facts: [
      fact(`${recommendationId}.area.free.current`, 'area.free', 'current', round6(measured.value.room.free_m2), 'm2', [roomRef]),
      fact(`${recommendationId}.equipment.count.current`, 'equipment.count', 'current', currentCount, 'count', [roomRef]),
      ...candidates.flatMap((candidate) => candidate.facts),
    ],
    ruleIds: rulesForObjectType(plan.catalog, type.id).map((rule) => rule.id),
    assumptions: [
      `Слепое пятно — самый большой связный участок клиентских зон, который не видит ни одна камера: ${formatShort(patch.length * cell * cell, 2)} м² в зонах ${zoneNames}. ` +
        `Покрытие клиентских зон камерами сейчас ${percentText(before.total.percent)}` +
        (effects.length === 0 ? '.' : `; с новой камерой: ${effects.join(', ')}.`),
      `Сектор обзора строится по углу и дальности из атрибутов камеры (новая — ${formatShort(angle)}°, ${formatShort(range)} м из справочника); стены и мебель обзор не перекрывают, видео не подключается. Это допущение команды для планирования покрытия, а не паспорт устройства.`,
      'Клиентская зона — по признаку «Открыта для клиентов» у зоны, её типа или зоны, в которую она вложена.',
      `Перебор: точки через ${formatShort(step_m)} м внутри клиентских зон, повороты через ${CAMERA_SEARCH.headingStep_deg}°; лучше тот вариант, что видит больше квадратов пятна (сетка ${formatShort(cell, 2)} м), при равенстве — ближе к пятну.`,
      `Размеры и высота взяты из справочника: ${type.label}, ${type.provenance}`,
    ],
    reasonCodes: [reasonCode],
    limitations: [
      REASON_CODE_SPECS[reasonCode].requiredLimitation,
      `Покрытие считается по квадратам ${formatShort(cell, 2)} м: край пятна точен до квадрата.`,
    ],
    changes: [],
  };
  return { ok: true, value: [recommendation] };
}

/** The candidate camera carries the angle and range it was scored with. */
function cameraObject(object: Equipment, representation: CameraFieldRepresentation, angle: number, range: number): Equipment {
  return {
    ...object,
    attributes: { ...object.attributes, [representation.angleAttribute]: angle, [representation.rangeAttribute]: range },
  };
}

/**
 * Points inside the scope zones and within reach of the patch, every heading;
 * scored by squares of the patch seen, best first. The point grid coarsens
 * until the whole sweep fits `maxTests`.
 */
function searchProbes(
  polygons: readonly Point[][],
  patch: readonly Point[],
  patchBox: BoundingBox,
  angle: number,
  range: number,
): { probes: Probe[]; step_m: number } {
  const box = {
    minX: patchBox.minX - range,
    maxX: patchBox.maxX + range,
    minY: patchBox.minY - range,
    maxY: patchBox.maxY + range,
  };
  const headings: number[] = [];
  for (let heading = 0; heading < 360; heading += CAMERA_SEARCH.headingStep_deg) headings.push(heading);

  const pointsAt = (step: number): Point[] => {
    const points: Point[] = [];
    for (let y = Math.floor(box.minY / step) * step + step / 2; y <= box.maxY; y += step) {
      for (let x = Math.floor(box.minX / step) * step + step / 2; x <= box.maxX; x += step) {
        const point: Point = [round6(x), round6(y)];
        if (polygons.some((polygon) => locatePoint(point, polygon) === 'inside')) points.push(point);
      }
    }
    return points;
  };
  // A huge spot is scored on an even sample of its squares, not all of them.
  const stride = Math.max(1, Math.ceil(patch.length / CAMERA_SEARCH.maxPatchSample));
  const sample = patch.filter((_, index) => index % stride === 0);
  let step: number = CAMERA_SEARCH.step_m;
  let points = pointsAt(step);
  while (points.length * headings.length * sample.length > CAMERA_SEARCH.maxTests) {
    step *= 2;
    points = pointsAt(step);
  }

  const middle: Point = [(patchBox.minX + patchBox.maxX) / 2, (patchBox.minY + patchBox.maxY) / 2];
  const probes: Probe[] = [];
  for (const position of points) {
    const near = sample.filter(
      (centre) => Math.abs(centre[0] - position[0]) <= range && Math.abs(centre[1] - position[1]) <= range,
    );
    if (near.length === 0) continue;
    for (const rotation_deg of headings) {
      const sees = viewSectorTest(position, rotation_deg, angle, range);
      let gain = 0;
      for (const centre of near) if (sees(centre)) gain += 1;
      if (gain > 0) {
        probes.push({ position, rotation_deg, gain, distance_m: round6(Math.hypot(position[0] - middle[0], position[1] - middle[1])) });
      }
    }
  }
  probes.sort(
    (a, b) =>
      b.gain - a.gain ||
      a.distance_m - b.distance_m ||
      a.position[0] - b.position[0] ||
      a.position[1] - b.position[1] ||
      a.rotation_deg - b.rotation_deg,
  );
  // One heading per point: the best one; other headings of the same point are not variants.
  const seen = new Set<string>();
  const best = probes.filter((probe) => {
    const key = `${probe.position[0]},${probe.position[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { probes: best, step_m: step };
}
