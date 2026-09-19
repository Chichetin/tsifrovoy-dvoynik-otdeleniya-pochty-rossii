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
import { PLACEMENT_SEARCH, findPlacements, zoneFit, type ZoneFit } from './placement';

export { checkEquipment } from './equipment';
export { comparePlans, diffPlans } from './compare';
export { PLACEMENT_ISSUE_CODES, PLACEMENT_SEARCH, findPlacements, zoneFit } from './placement';
export type { ZoneFit } from './placement';
export {
  EXPLANATION_ISSUE_CODES,
  defaultExplanation,
  verifyExplanation,
} from './explanation';
export { fallbackExplanation, renderExplanation } from './templates';

/** How the search was run, said plainly — the user is owed the method. */
function searchNote(pinned: boolean): string {
  const order = pinned
    ? 'кольцами от указанной точки'
    : 'вдоль стен, затем кольцами от середины';
  return (
    `Перебор: сетка ${PLACEMENT_SEARCH.step_m} м, углы ` +
    `${PLACEMENT_SEARCH.angles_deg.join(' и ')}°, не более ` +
    `${PLACEMENT_SEARCH.maxProbes} проверок, ${order}.`
  );
}

function ruleNotes(plan: PlanDocument, typeId: Id): string[] {
  return rulesForObjectType(plan.catalog, typeId).map((rule) =>
    rule.source === 'organizer-material'
      ? `${rule.rationale} (материалы организаторов, ${rule.id})`
      : `${rule.rationale} (допущение команды, не норматив Почты России, ${rule.id})`,
  );
}

function zoneTypeLabels(plan: PlanDocument, ids: Id[]): string {
  return ids
    .map((id) => `«${plan.catalog.zoneTypes.find((type) => type.id === id)?.label ?? id}»`)
    .join(', ');
}

/**
 * What the zone filter did, in words. Nothing is said when an explicitly
 * chosen zone is already a fitting one or the type has no zone rule and a zone
 * was chosen: the answer then is exactly what was asked for.
 */
function zoneFitNotes(
  plan: PlanDocument,
  fit: ZoneFit,
  request: Extract<AdviceRequest, { scenario: 'place' }>,
  typeLabel: string,
  found: number,
): { assumptions: string[]; limitations: string[] } {
  const none = { assumptions: [], limitations: [] };
  const rules = fit.ruleIds.join(', ');
  const placed =
    fit.placedZoneTypeIds.length === 0
      ? 'в плане таких объектов пока нет'
      : `в плане такие объекты уже стоят в зонах ${zoneTypeLabels(plan, fit.placedZoneTypeIds)}`;
  const basis =
    `Уместные зоны — по правилам команды (${rules}) и по текущей расстановке: ${placed}. ` +
    `Это правило команды, не норматив Почты России.`;
  const types = zoneTypeLabels(plan, fit.zoneTypeIds);

  if (fit.mode === 'no-rule') {
    return request.zoneId === null
      ? {
          assumptions: [
            `Для «${typeLabel}» в справочнике нет правила комплектования с минимумом по зонам — место искали по всему помещению, в любой зоне.`,
          ],
          limitations: [],
        }
      : none;
  }
  if (fit.mode === 'off-floor') {
    return request.zoneId === null
      ? {
          assumptions: [
            `«${typeLabel}» не занимает пол (крепится на стену, потолок или ставится на стол) — по зонам поиск не сужали.`,
          ],
          limitations: [],
        }
      : none;
  }
  if (fit.mode === 'no-zones') {
    return {
      assumptions: [
        `В плане нет зон — уместность зоны не проверялась. По правилам команды (${rules}) «${typeLabel}» ожидается в зонах ${types}.`,
      ],
      limitations: [],
    };
  }
  if (fit.mode === 'override') {
    const chosen = plan.zones.find((zone) => zone.id === request.zoneId);
    return {
      assumptions: [
        `Зона «${chosen?.name ?? request.zoneId}» (${request.zoneId}) выбрана явно, хотя уместными для «${typeLabel}» считаются зоны ${types}. Варианты показаны по вашему выбору. ${basis}`,
      ],
      limitations: [],
    };
  }
  if (fit.mode === 'missing') {
    return {
      assumptions: [basis],
      limitations: [
        `В плане нет зоны типа ${types}, где «${typeLabel}» уместен по правилам команды (${rules}) и по текущей расстановке. Разметьте такую зону или выберите зону явно.`,
      ],
    };
  }

  if (request.zoneId !== null && found > 0) return none;
  const zones = plan.zones
    .filter((zone) => fit.zoneIds?.includes(zone.id))
    .map((zone) => `«${zone.name}» (${zone.id})`)
    .join(', ');
  const scope =
    request.zoneId === null
      ? `Искали только в зонах, где «${typeLabel}» уместен: ${zones}.`
      : `Во вложенных зонах другого назначения места не предлагаются: «${typeLabel}» уместен в зонах ${zones}.`;
  return {
    assumptions: [`${scope} ${basis}`],
    limitations:
      found > 0
        ? []
        : [`Места не нашлось в уместных зонах: ${zones}. В зонах другого типа не искали — выберите зону явно, если это нужно.`],
  };
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
  // The zone each candidate lands in is an existing entity the answer rests on.
  const refs: Ref[] = [targetRef];
  for (const candidate of found.value) {
    const zoneId = candidate.object.zoneId;
    if (zoneId !== null && !refs.some((ref) => ref.kind === 'zone' && ref.id === zoneId)) {
      refs.push({ kind: 'zone', id: zoneId });
    }
  }
  const fitNotes = zoneFitNotes(
    plan,
    zoneFit(plan, request.typeId, request.zoneId),
    request,
    type?.label ?? request.typeId,
    found.value.length,
  );
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
        refs,
        candidates,
        facts,
        ruleIds: rulesForObjectType(plan.catalog, request.typeId).map((rule) => rule.id),
        assumptions: [
          `Размеры и высота взяты из справочника: ${type?.label ?? request.typeId}, ${type?.provenance ?? 'источник не указан'}.`,
          searchNote(request.anchor !== undefined),
          request.anchor === undefined
            ? 'Допущение команды, не норматив Почты России: при прочих равных место у стены лучше места посреди зала — середина нужна людям для прохода.'
            : 'Точку указали вручную: варианты ранжируются по близости к ней, а не к стене.',
          ...ruleNotes(plan, request.typeId),
          ...fitNotes.assumptions,
        ],
        reasonCodes: [reasonCode],
        limitations: [REASON_CODE_SPECS[reasonCode].requiredLimitation, ...fitNotes.limitations],
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
