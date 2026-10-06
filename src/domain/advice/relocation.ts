/**
 * #177: «Предложить место» for an object that already stands. The object is
 * lifted out, the placement search runs with its own size and outline, and each
 * spot returns as one `object.put` that must apply, pass physics and add no
 * validation error. «Оставить как есть» is always last, with the same numbers.
 * Every number is code (`comparePlans`, `measurePlan`, `buildInventory`,
 * `cameraCoverage`). Nothing here edits the document.
 */

import type { Fact, Recommendation } from '../../contracts/advice';
import type { Command } from '../../contracts/commands';
import type { Equipment, Id, PlanDocument, Point, Result } from '../../contracts/model';
import { applyCommand } from '../commands';
import { footprint } from '../geometry';
import { buildInventory } from '../inventory';
import { measurePlan } from '../metrics';
import { editRejection } from '../physics';
import { validatePlan } from '../validation';
import { cameraCoverage, fieldRepresentationFor } from './camera-coverage';
import { comparePlans } from './compare';
import { issueKey, PLACEMENT_ISSUE_CODES, placementZonePath, searchPlacements, wallEdgesFor, wallGap } from './placement';

export type RelocationRequest = { objectId: Id; zoneId: Id | null; anchor?: Point };

export type Pair = { before: number; after: number };

export type RelocationOption = {
  id: Id;
  kind: 'keep' | 'move';
  /** The object where this option puts it; the same id, inventory number and attributes. */
  object: Equipment;
  /** `object.put` for a move — one command, one undo step; null for «оставить как есть». */
  command: Command | null;
  /** From the inventory zone down to the zone under the centre, with names. */
  zones: { id: Id; name: string }[];
  /** Count rules of the type for the option's zone type, and distance rules of the type. */
  ruleIds: Id[];
  wallGap_m: number;
  /** Warnings the option adds to the plan as it is now; errors are never added. */
  warnings: number;
  /** `comparePlans(plan, after)`: free area, occupied area, travelled distance. */
  facts: Fact[];
  /** Source and target zone: free area (`measurePlan`) and objects (`buildInventory`). */
  zoneEffects: { zoneId: Id; free_m2: Pair; objects: Pair }[];
  /** Camera coverage of the client zones, %; null when the type is not a camera. */
  coverage: { before: number | null; after: number | null } | null;
};

export type Relocation = { objectId: Id; options: RelocationOption[] };

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export function findRelocations(plan: PlanDocument, request: RelocationRequest): Result<Relocation> {
  const current = plan.objects.find((entry) => entry.id === request.objectId);
  const type = current === undefined ? undefined : plan.catalog.objectTypes.find((entry) => entry.id === current.typeId);
  if (current === undefined || type === undefined) {
    const message = current === undefined ? `Объекта «${request.objectId}» нет в плане.` : `Тип объекта «${current.typeId}» отсутствует в справочнике плана.`;
    return { ok: false, issues: [{ code: current === undefined ? PLACEMENT_ISSUE_CODES.OBJECT_MISSING : PLACEMENT_ISSUE_CODES.UNKNOWN_OBJECT_TYPE, severity: 'error', message, refs: [{ kind: 'object', id: request.objectId }] }] };
  }

  // The search sees the object's own shape, and the object does not block itself.
  const own = { ...type, defaultSize_m: current.size_m, defaultBase_m: current.base_m, defaultHeight_m: current.height_m, ...(current.outline === undefined ? {} : { outline: current.outline }) };
  const lifted: PlanDocument = {
    ...plan,
    objects: plan.objects.filter((entry) => entry.id !== current.id),
    catalog: { ...plan.catalog, objectTypes: plan.catalog.objectTypes.map((entry) => (entry.id === type.id ? own : entry)) },
  };
  const found = current.locked === true ? ({ ok: true, value: [] } as const) : searchPlacements(lifted, { scenario: 'place', typeId: type.id, zoneId: request.zoneId, ...(request.anchor === undefined ? {} : { anchor: request.anchor }) }, current.position);
  if (!found.ok) return found;

  const known = new Set(validatePlan(plan).map(issueKey));
  const wallEdges = wallEdgesFor(plan, type);
  const representation = fieldRepresentationFor(plan.catalog, type.id);
  const coverageOf = (document: PlanDocument): number | null => (representation === null ? null : cameraCoverage(document, representation).total.percent);
  const measuredBefore = measurePlan(plan);
  if (!measuredBefore.ok) return measuredBefore;
  const zonesBefore = measuredBefore.value.zones;
  const inventoryBefore = buildInventory(plan);
  const coverageBefore = coverageOf(plan);

  const option = (id: Id, after: PlanDocument, object: Equipment, command: Command | null, warnings: number): RelocationOption | null => {
    const compared = comparePlans(plan, after);
    const measuredAfter = measurePlan(after);
    if (!compared.ok || !measuredAfter.ok) return null;
    const inventoryAfter = buildInventory(after);
    const path = placementZonePath(after, object);
    const deepest = after.zones.find((zone) => zone.id === path[path.length - 1]);
    const affected = [...new Set([current.zoneId, object.zoneId].filter((zoneId): zoneId is Id => zoneId !== null))];
    return {
      id,
      kind: command === null ? 'keep' : 'move',
      object,
      command,
      zones: path.map((zoneId) => ({ id: zoneId, name: after.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId })),
      ruleIds: plan.catalog.rules
        .filter((rule) => rule.objectTypeId === type.id && (rule.kind !== 'count' || rule.zoneTypeId === deepest?.typeId))
        .map((rule) => rule.id),
      wallGap_m: round6(wallGap(footprint(object), wallEdges)),
      warnings,
      facts: compared.value[0]!.facts.map((fact) => ({ ...fact, id: fact.id.replace(/^adv_compare/, id) })),
      zoneEffects: affected.map((zoneId) => ({
        zoneId,
        free_m2: { before: round6(zonesBefore[zoneId]?.free_m2 ?? 0), after: round6(measuredAfter.value.zones[zoneId]?.free_m2 ?? 0) },
        objects: { before: inventoryBefore.byZoneDirect[zoneId] ?? 0, after: inventoryAfter.byZoneDirect[zoneId] ?? 0 },
      })),
      coverage: representation === null ? null : { before: coverageBefore, after: coverageOf(after) },
    };
  };

  const options: RelocationOption[] = [];
  for (const candidate of found.value) {
    const { position, rotation_deg } = candidate.object;
    const command: Command = { type: 'object.put', object: { ...current, position, rotation_deg } };
    const applied = applyCommand(plan, command);
    if (!applied.ok || editRejection(plan, applied.value, command) !== null) continue;
    const fresh = validatePlan(applied.value).filter((entry) => !known.has(issueKey(entry)));
    if (fresh.some((entry) => entry.severity === 'error')) continue;
    const moved = applied.value.objects.find((entry) => entry.id === current.id)!;
    const entry = option(`${current.id}.move_${options.length + 1}`, applied.value, moved, command, fresh.length);
    if (entry !== null) options.push(entry);
  }
  // The plan was measured above, so comparing it with itself cannot fail.
  options.push(option(`${current.id}.keep`, plan, current, null, 0)!);
  return { ok: true, value: { objectId: current.id, options } };
}

/**
 * #203: a `place` recommendation applied as a move of an object that already
 * stands. The search offered spots for one more object of the type; a person
 * drags the existing one there instead. Each candidate's forecast is then the
 * move's, not the addition's: the plan with the object moved is measured
 * (`comparePlans`), the count of the type stays the same, and the distance to
 * the entrance is added «было → стало» when a rule of the type measures it.
 * Ids of the recommendation, candidates and facts stay as they were, so an
 * explanation chosen for the search still points at existing facts. A spot the
 * object cannot be moved to is dropped; none left is an error, not a silent
 * «места нет». Nothing here edits the document.
 */
export function asRelocation(plan: PlanDocument, recommendation: Recommendation, objectId: Id): Result<Recommendation> {
  const current = plan.objects.find((entry) => entry.id === objectId);
  if (current === undefined) {
    return { ok: false, issues: [{ code: PLACEMENT_ISSUE_CODES.OBJECT_MISSING, severity: 'error', message: `Объекта «${objectId}» нет в плане.`, refs: [{ kind: 'object', id: objectId }] }] };
  }
  const count = (document: PlanDocument): number => document.objects.filter((entry) => entry.typeId === current.typeId).length;
  const objectRef = { kind: 'object', id: objectId } as const;

  const candidates: Recommendation['candidates'] = [];
  for (const candidate of recommendation.candidates) {
    const { position, rotation_deg } = candidate.object;
    const applied = applyCommand(plan, { type: 'object.put', object: { ...current, position, rotation_deg } });
    if (!applied.ok) continue;
    const compared = comparePlans(plan, applied.value);
    if (!compared.ok) return compared;
    const measured = compared.value[0]!.facts;
    const value = (metric: Fact['metric'], phase: Fact['phase'], prefix: string): number | undefined =>
      measured.find((fact) => fact.metric === metric && fact.phase === phase && fact.id.startsWith(prefix))?.value;
    const freeAfter = value('area.free', 'after', 'adv_compare.area.free');
    if (freeAfter === undefined) continue;
    // #237: расстояние до входа у переноса — своё, «было → стало» ниже.
    const facts: Fact[] = candidate.facts.filter((fact) => fact.metric !== 'layout.entrance').map((fact) => {
      if (fact.metric === 'area.free' && fact.phase === 'after') return { ...fact, value: freeAfter };
      if (fact.metric === 'equipment.count' && fact.phase === 'after') return { ...fact, value: count(applied.value) };
      if (fact.metric === 'equipment.count' && fact.phase === 'current') return { ...fact, value: count(plan) };
      return fact;
    });
    const entrance = `adv_compare.entrance.${objectId}`;
    const was = value('layout.entrance', 'before', entrance);
    const now = value('layout.entrance', 'after', entrance);
    const shift = value('layout.entrance', 'delta', entrance);
    if (was !== undefined && now !== undefined && shift !== undefined) {
      facts.push(
        { id: `${candidate.id}.layout.entrance.current`, metric: 'layout.entrance', phase: 'current', value: was, unit: 'm', refs: [objectRef] },
        { id: `${candidate.id}.layout.entrance.after`, metric: 'layout.entrance', phase: 'after', value: now, unit: 'm', refs: [objectRef] },
        { id: `${candidate.id}.layout.entrance.delta`, metric: 'layout.entrance', phase: 'delta', value: shift, unit: 'm', refs: [objectRef] },
      );
    }
    candidates.push({ ...candidate, facts });
  }

  if (recommendation.candidates.length > 0 && candidates.length === 0) {
    return { ok: false, issues: [{ code: 'RELOCATION_IMPOSSIBLE', severity: 'error', message: `Объект «${objectId}» нельзя перенести ни в одно из найденных мест.`, refs: [objectRef] }] };
  }
  const own = new Set(recommendation.candidates.flatMap((candidate) => candidate.facts.map((fact) => fact.id)));
  const facts: Fact[] = [
    ...recommendation.facts
      .filter((fact) => !own.has(fact.id))
      .map((fact) => (fact.metric === 'equipment.count' && fact.phase === 'current' ? { ...fact, value: count(plan) } : fact)),
    ...candidates.flatMap((candidate) => candidate.facts),
  ];
  return {
    ok: true,
    value: {
      ...recommendation,
      refs: recommendation.refs.some((ref) => ref.kind === 'object' && ref.id === objectId) ? recommendation.refs : [...recommendation.refs, objectRef],
      candidates,
      facts,
      assumptions: [
        ...recommendation.assumptions,
        `Вариант применяется переносом стоящего объекта «${current.label}» (${objectId}): id, инвентарный номер и атрибуты сохраняются, число объектов этого типа не меняется. Расстояние до входа — от центра объекта до центра входа.`,
      ],
    },
  };
}
