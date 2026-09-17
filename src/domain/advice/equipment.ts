/**
 * A02: what is missing from a zone and what is there in excess.
 *
 * The rules live in `data/catalog/rules.json` and travel inside the plan, so a
 * new requirement is a line of JSON, never a branch in this file. Nothing here
 * knows what a cashier window or a bench is: it applies min/max of a rule to the
 * count the inventory gives it.
 *
 * Every recommendation says out loud whose rule it follows. A rule marked
 * `team-assumption` is our invention, and the text says so — the jury must be
 * able to tell our assumption from a requirement of Russian Post.
 */

import type { CheckEquipment, Fact, Recommendation } from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import type { CountRule, Equipment, Id, PlanDocument, Ref, Rule, Zone } from '../../contracts/model';
import { countInZoneScope } from '../inventory';

/** Count rules only: where an object stands is V01's question, not this one. */
function countRules(plan: PlanDocument, zone: Zone): CountRule[] {
  return plan.catalog.rules.filter(
    (rule): rule is CountRule => rule.kind === 'count' && rule.zoneTypeId === zone.typeId,
  );
}

function sourceNote(rule: Rule): string {
  return rule.source === 'organizer-material'
    ? `Источник правила: материалы организаторов (${rule.id}).`
    : `Источник правила: допущение команды, не норматив Почты России (${rule.id}).`;
}

/** The objects the rule counted, so the user can look at them on the plan. */
function countedObjects(plan: PlanDocument, rule: CountRule, zone: Zone): Equipment[] {
  const parents = new Map(plan.zones.map((entry) => [entry.id, entry.parentId]));
  return plan.objects.filter(
    (object) =>
      object.typeId === rule.objectTypeId &&
      (rule.scope === 'direct'
        ? object.zoneId === zone.id
        : isUnderZone(object.zoneId, zone.id, parents)),
  );
}

/** Walks up the zone chain; the guard keeps a mid-edit cycle from hanging it. */
function isUnderZone(
  zoneId: Id | null,
  ancestorId: Id,
  parents: Map<Id, Id | null>,
): boolean {
  const seen = new Set<Id>();
  let current = zoneId;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

function fact(
  id: Id,
  metric: Fact['metric'],
  value: number,
  refs: Ref[],
): Fact {
  return { id, metric, phase: 'current', value, unit: 'count', refs };
}

function recommendation(
  plan: PlanDocument,
  rule: CountRule,
  zone: Zone,
  count: number,
  kind: 'missing' | 'excess',
  bound: number,
): Recommendation {
  const id = `adv_${rule.id}_${zone.id}_${kind}`;
  const reasonCode = kind === 'missing' ? 'equipment.missing' : 'equipment.excess';
  const boundMetric = kind === 'missing' ? 'equipment.min' : 'equipment.max';
  const objects = countedObjects(plan, rule, zone);
  const scopeNote =
    rule.scope === 'direct'
      ? 'Считались объекты самой зоны, без вложенных.'
      : 'Считались объекты зоны вместе с вложенными.';

  return {
    id,
    scenario: 'equipment',
    refs: [
      { kind: 'zone', id: zone.id },
      ...objects.map((object): Ref => ({ kind: 'object', id: object.id })),
    ],
    candidates: [],
    facts: [
      fact(`${id}.count`, 'equipment.count', count, [{ kind: 'zone', id: zone.id }]),
      fact(`${id}.bound`, boundMetric, bound, [{ kind: 'zone', id: zone.id }]),
    ],
    ruleIds: [rule.id],
    assumptions: [rule.rationale, sourceNote(rule), scopeNote],
    reasonCodes: [reasonCode],
    // The wording is fixed by the contract and checked by A04; adding to it is
    // allowed, replacing it is not.
    limitations: [REASON_CODE_SPECS[reasonCode].requiredLimitation],
    changes: [],
  };
}

/**
 * Shortages and excesses of the plan, zone by zone. An empty list means every
 * rule of the catalog is satisfied for the zones asked about — not that there
 * is nothing to improve, only that these rules have nothing to say.
 */
export const checkEquipment: CheckEquipment = (plan, request) => {
  const zones =
    request.zoneId === null
      ? plan.zones
      : plan.zones.filter((zone) => zone.id === request.zoneId);

  const recommendations: Recommendation[] = [];
  for (const zone of zones) {
    for (const rule of countRules(plan, zone)) {
      const count = countInZoneScope(plan, rule.objectTypeId, zone.id, rule.scope);
      if (rule.min !== null && count < rule.min) {
        recommendations.push(recommendation(plan, rule, zone, count, 'missing', rule.min));
      }
      if (rule.max !== null && count > rule.max) {
        recommendations.push(recommendation(plan, rule, zone, count, 'excess', rule.max));
      }
    }
  }
  return recommendations;
};
