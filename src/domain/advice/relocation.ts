/**
 * #177: «Предложить место» for an object that already stands. The object is
 * lifted out, the placement search runs with its own size and outline, and each
 * spot returns as one `object.put` that must apply, pass physics and add no
 * validation error. «Оставить как есть» is always last, with the same numbers.
 * Every number is code (`comparePlans`, `measurePlan`, `buildInventory`,
 * `cameraCoverage`). Nothing here edits the document.
 */

import type { Fact } from '../../contracts/advice';
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
