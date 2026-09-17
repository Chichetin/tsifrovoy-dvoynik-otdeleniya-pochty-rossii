/**
 * A03 (сравнение): what changed between two snapshots of a plan, in numbers.
 *
 * Both sides are measured by the same `measurePlan`, so "было → стало" is the
 * arithmetic the editor shows and not a second opinion. Overlapping objects are
 * not subtracted twice on either side, because the occupied floor is a union,
 * and nested zones are never summed.
 *
 * The diff itself is by id: an object that kept its id and moved is `moved`, a
 * new id is `added`. That is deliberate — an id is what survives saving and
 * reopening, so it is the only thing that can tell "moved the counter" from
 * "removed one counter and bought another".
 */

import type { Change, ComparePlans, Fact, Recommendation } from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import type {
  Equipment,
  Id,
  Layer,
  PlanDocument,
  Point,
  Ref,
  Zone,
} from '../../contracts/model';
import { measurePlan } from '../metrics';

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Position or angle changed: the object is in another place. */
function hasMoved(before: Equipment, after: Equipment): boolean {
  return (
    !samePoint(before.position, after.position) ||
    before.rotation_deg !== after.rotation_deg
  );
}

/** Anything else the document carries about the object. */
function hasChangedOtherwise(before: Equipment, after: Equipment): boolean {
  return (
    before.typeId !== after.typeId ||
    before.label !== after.label ||
    !samePoint(before.size_m, after.size_m) ||
    before.base_m !== after.base_m ||
    before.height_m !== after.height_m ||
    before.zoneId !== after.zoneId ||
    before.layerId !== after.layerId ||
    JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)
  );
}

function zoneChanged(before: Zone, after: Zone): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function layerChanged(before: Layer, after: Layer): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function byId<T extends { id: Id }>(items: T[]): Map<Id, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Every difference between the documents, in document order of the newer one
 * first, then whatever disappeared. The list is what the UI lists; the numbers
 * live in the facts.
 */
export function diffPlans(before: PlanDocument, after: PlanDocument): Change[] {
  const changes: Change[] = [];

  const oldObjects = byId(before.objects);
  for (const object of after.objects) {
    const previous = oldObjects.get(object.id);
    if (previous === undefined) {
      changes.push({ ref: { kind: 'object', id: object.id }, kind: 'added' });
      continue;
    }
    // A move is reported as a move even when an attribute changed with it: the
    // user sees one action, not two.
    if (hasMoved(previous, object)) {
      changes.push({ ref: { kind: 'object', id: object.id }, kind: 'moved' });
    } else if (hasChangedOtherwise(previous, object)) {
      changes.push({ ref: { kind: 'object', id: object.id }, kind: 'updated' });
    }
  }
  const newObjects = byId(after.objects);
  for (const object of before.objects) {
    if (newObjects.has(object.id)) continue;
    changes.push({ ref: { kind: 'object', id: object.id }, kind: 'removed' });
  }

  const oldZones = byId(before.zones);
  for (const zone of after.zones) {
    const previous = oldZones.get(zone.id);
    if (previous === undefined)
      changes.push({ ref: { kind: 'zone', id: zone.id }, kind: 'added' });
    else if (zoneChanged(previous, zone)) {
      changes.push({ ref: { kind: 'zone', id: zone.id }, kind: 'updated' });
    }
  }
  const newZones = byId(after.zones);
  for (const zone of before.zones) {
    if (newZones.has(zone.id)) continue;
    changes.push({ ref: { kind: 'zone', id: zone.id }, kind: 'removed' });
  }

  const oldLayers = byId(before.layers);
  for (const layer of after.layers) {
    const previous = oldLayers.get(layer.id);
    if (previous === undefined)
      changes.push({ ref: { kind: 'layer', id: layer.id }, kind: 'added' });
    else if (layerChanged(previous, layer)) {
      changes.push({ ref: { kind: 'layer', id: layer.id }, kind: 'updated' });
    }
  }
  const newLayers = byId(after.layers);
  for (const layer of before.layers) {
    if (newLayers.has(layer.id)) continue;
    changes.push({ ref: { kind: 'layer', id: layer.id }, kind: 'removed' });
  }

  if (JSON.stringify(before.room) !== JSON.stringify(after.room)) {
    changes.push({ ref: { kind: 'room', id: after.room.id }, kind: 'updated' });
  }

  return changes;
}

/** Total distance the objects that kept their id have travelled. */
function travelled(before: PlanDocument, after: PlanDocument): number {
  const previous = byId(before.objects);
  let total = 0;
  for (const object of after.objects) {
    const was = previous.get(object.id);
    if (was === undefined) continue;
    total += Math.hypot(
      object.position[0] - was.position[0],
      object.position[1] - was.position[1],
    );
  }
  return round6(total);
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

/** before, after and their difference as three facts of one metric. */
function triple(
  prefix: string,
  metric: Fact['metric'],
  unit: Fact['unit'],
  before: number,
  after: number,
  refs: Ref[],
): Fact[] {
  return [
    fact(`${prefix}.before`, metric, 'before', round6(before), unit, refs),
    fact(`${prefix}.after`, metric, 'after', round6(after), unit, refs),
    fact(`${prefix}.delta`, metric, 'delta', round6(after - before), unit, refs),
  ];
}

/**
 * The effect of an edit on the numbers the branch is judged by. Fails only when
 * one of the snapshots cannot be measured at all; "ничего не изменилось" is an
 * answer, not a failure.
 */
export const comparePlans: ComparePlans = (before, after) => {
  const measuredBefore = measurePlan(before);
  if (!measuredBefore.ok) return measuredBefore;
  const measuredAfter = measurePlan(after);
  if (!measuredAfter.ok) return measuredAfter;

  const changes = diffPlans(before, after);
  const roomRef: Ref = { kind: 'room', id: after.room.id };
  const id = 'adv_compare';

  const added = changes.filter(
    (change) => change.kind === 'added' && change.ref.kind === 'object',
  );
  const removed = changes.filter(
    (change) => change.kind === 'removed' && change.ref.kind === 'object',
  );

  const facts: Fact[] = [
    ...triple(
      `${id}.area.total`,
      'area.total',
      'm2',
      measuredBefore.value.room.total_m2,
      measuredAfter.value.room.total_m2,
      [roomRef],
    ),
    ...triple(
      `${id}.area.occupied`,
      'area.occupied',
      'm2',
      measuredBefore.value.room.occupied_m2,
      measuredAfter.value.room.occupied_m2,
      [roomRef],
    ),
    ...triple(
      `${id}.area.free`,
      'area.free',
      'm2',
      measuredBefore.value.room.free_m2,
      measuredAfter.value.room.free_m2,
      [roomRef],
    ),
    ...triple(
      `${id}.equipment.count`,
      'equipment.count',
      'count',
      before.objects.length,
      after.objects.length,
      [roomRef],
    ),
    fact(`${id}.objects.added`, 'objects.added', 'delta', added.length, 'count', [
      roomRef,
    ]),
    fact(`${id}.objects.removed`, 'objects.removed', 'delta', removed.length, 'count', [
      roomRef,
    ]),
    // Перенос без изменения площади и числа объектов виден только так: это
    // измеренная величина, а не признак «что-то поменялось».
    fact(
      `${id}.placement.distance`,
      'placement.distance',
      'delta',
      travelled(before, after),
      'm',
      [roomRef],
    ),
  ];

  // A moved object changes no area and no count, so the reason code cannot be
  // decided by the diff alone: it follows the measured deltas, exactly as the
  // semantic dictionary requires.
  const measurable = facts.some((entry) => entry.phase === 'delta' && entry.value !== 0);
  const reasonCode = measurable ? 'comparison.changed' : 'comparison.unchanged';

  const limitations = [REASON_CODE_SPECS[reasonCode].requiredLimitation];
  if (!measurable && changes.length > 0) {
    limitations.push(
      'Различия между снимками есть, но на площади и число объектов они не влияют: они перечислены в списке изменений.',
    );
  }

  const recommendation: Recommendation = {
    id,
    scenario: 'compare',
    refs: [roomRef],
    candidates: [],
    facts,
    ruleIds: [],
    assumptions: [
      'Свободная площадь — это площадь помещения минус объединение отпечатков оборудования: пересечение объектов не вычитается дважды.',
      'Площади вложенных зон не складываются: объект занимает пол и во вложенной зоне, и в родительской.',
    ],
    reasonCodes: [reasonCode],
    limitations,
    changes,
  };

  return { ok: true, value: [recommendation] };
};
