/**
 * A03: the public face of the assistant's calculation.
 *
 * Three scenarios of the brief — where to put it, what is missing or extra,
 * what an edit did — come back as the same `Recommendation` shape, filled by
 * code. No text is generated here beyond the assumptions and limitations the
 * calculation can vouch for: the model's job is to pick one of the reason codes
 * offered and to cite facts that already exist, never to produce a number.
 */

import type {
  AdviceRequest,
  CalculateAdvice,
  Fact,
  Recommendation,
} from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import type { Id, PlanDocument, Ref, Result } from '../../contracts/model';
import { findObjectType, rulesForObjectType } from '../catalog';
import { measurePlan } from '../metrics';
import { checkEquipment } from './equipment';
import { comparePlans } from './compare';
import { PLACEMENT_SEARCH, findPlacements } from './placement';

export { checkEquipment } from './equipment';
export { comparePlans, diffPlans } from './compare';
export { PLACEMENT_ISSUE_CODES, PLACEMENT_SEARCH, findPlacements } from './placement';

/** How the search was run, said plainly — the user is owed the method. */
function searchNote(): string {
  return (
    `Перебор: сетка ${PLACEMENT_SEARCH.step_m} м, углы ` +
    `${PLACEMENT_SEARCH.angles_deg.join(' и ')}°, не более ` +
    `${PLACEMENT_SEARCH.maxProbes} проверок, кольцами от указанной точки.`
  );
}

function ruleNotes(plan: PlanDocument, typeId: Id): string[] {
  return rulesForObjectType(plan.catalog, typeId).map((rule) =>
    rule.source === 'organizer-material'
      ? `${rule.rationale} (материалы организаторов, ${rule.id})`
      : `${rule.rationale} (допущение команды, не норматив Почты России, ${rule.id})`,
  );
}

function placementAdvice(
  plan: PlanDocument,
  request: Extract<AdviceRequest, { scenario: 'place' }>,
): Result<Recommendation[]> {
  const found = findPlacements(plan, request);
  if (!found.ok) return found;

  const measured = measurePlan(plan);
  if (!measured.ok) return measured;

  const type = findObjectType(plan.catalog, request.typeId);
  const roomRef: Ref = { kind: 'room', id: plan.room.id };
  const targetRef: Ref =
    request.zoneId === null ? roomRef : { kind: 'zone', id: request.zoneId };
  const id = `adv_place_${request.typeId}_${request.zoneId ?? plan.room.id}`;
  const candidates = found.value;
  const reasonCode = candidates.length > 0 ? 'placement.available' : 'placement.none';

  const currentCount = plan.objects.filter(
    (object) => object.typeId === request.typeId,
  ).length;
  const facts: Fact[] = [
    {
      id: `${id}.area.free.current`,
      metric: 'area.free',
      phase: 'current',
      value: Math.round(measured.value.room.free_m2 * 1e6) / 1e6,
      unit: 'm2',
      refs: [roomRef],
    },
    {
      id: `${id}.equipment.count.current`,
      metric: 'equipment.count',
      phase: 'current',
      value: currentCount,
      unit: 'count',
      refs: [roomRef],
    },
    // Прогноз у каждого кандидата свой, поэтому факты кандидатов входят в
    // рекомендацию целиком: объяснение обязано ссылаться на факты того
    // варианта, который выбрало.
    ...candidates.flatMap((candidate) => candidate.facts),
  ];

  return {
    ok: true,
    value: [
      {
        id,
        scenario: 'place',
        refs: [targetRef],
        candidates,
        facts,
        ruleIds: rulesForObjectType(plan.catalog, request.typeId).map((rule) => rule.id),
        assumptions: [
          `Размеры и высота взяты из справочника: ${type?.label ?? request.typeId}, ${type?.provenance ?? 'источник не указан'}.`,
          searchNote(),
          ...ruleNotes(plan, request.typeId),
        ],
        reasonCodes: [reasonCode],
        limitations: [REASON_CODE_SPECS[reasonCode].requiredLimitation],
        changes: [],
      },
    ],
  };
}

/**
 * Recommendations for one question about one plan. An empty list is a valid
 * answer — it means the calculation has nothing to say, and the UI says exactly
 * that instead of inventing advice.
 */
export const calculateAdvice: CalculateAdvice = (plan, request) => {
  if (request.scenario === 'equipment') {
    return { ok: true, value: checkEquipment(plan, request) };
  }
  if (request.scenario === 'compare') {
    return comparePlans(request.before, plan);
  }

  return placementAdvice(plan, request);
};
