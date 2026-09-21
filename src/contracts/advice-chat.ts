/**
 * Narrow contract for the two conversational model calls.
 *
 * The model can classify a request and select already-calculated evidence. It
 * cannot introduce measurements, plan commands, entities or response prose.
 */

import { z } from 'zod';
import type { AdviceRequest, Fact, Recommendation } from './advice';
import { LIMITS, type Id, type Issue, type PlanDocument, type Ref, type Result } from './model';

export type AssistantAction =
  | { kind: 'focus'; ref: Ref }
  | { kind: 'open-properties'; objectId: Id }
  | { kind: 'filter-inventory'; typeId?: Id; zoneId?: Id }
  | { kind: 'show-layer'; layerId: Id }
  | { kind: 'preview-candidate'; recommendationId: Id; candidateId: Id };

/** A compare intent deliberately carries no prior document from the model. */
export type ChatAdviceRequest =
  | Exclude<AdviceRequest, { scenario: 'compare' }>
  | { scenario: 'compare' };

export type ChatIntent =
  | { kind: 'clarify'; question: string }
  | { kind: 'request'; request: ChatAdviceRequest; preference: string | null };

export type ChatSelectionEntry = {
  recommendationId: Id;
  factIds: Id[];
  actions: AssistantAction[];
};

/** Selections are references to a deterministic calculation, never an answer text. */
export type ChatSelection = { selections: ChatSelectionEntry[] };

/** Compact, browser-only record for a confirmed conversation exchange. */
export type ChatTurn = {
  id: Id;
  revision: number;
  intent: ChatIntent;
  selection: ChatSelection | null;
  refs: Ref[];
};

export const CHAT_ISSUE_CODES = {
  SHAPE_INVALID: 'CHAT_SHAPE_INVALID',
  UNKNOWN_OBJECT_TYPE: 'CHAT_UNKNOWN_OBJECT_TYPE',
  UNKNOWN_ZONE: 'CHAT_UNKNOWN_ZONE',
  UNKNOWN_RECOMMENDATION: 'CHAT_UNKNOWN_RECOMMENDATION',
  DUPLICATE_RECOMMENDATION: 'CHAT_DUPLICATE_RECOMMENDATION',
  UNKNOWN_FACT: 'CHAT_UNKNOWN_FACT',
  CANDIDATE_MISMATCH: 'CHAT_CANDIDATE_MISMATCH',
  UNKNOWN_REF: 'CHAT_UNKNOWN_REF',
  ACTION_TARGET_NOT_ALLOWED: 'CHAT_ACTION_TARGET_NOT_ALLOWED',
  UNKNOWN_OBJECT: 'CHAT_UNKNOWN_OBJECT',
  UNKNOWN_LAYER: 'CHAT_UNKNOWN_LAYER',
} as const;

const idSchema = z.string().min(1);
const refSchema = z
  .object({
    kind: z.enum(['room', 'zone', 'object', 'layer', 'wall', 'opening']),
    id: idSchema,
  })
  .strict();

const intentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clarify'), question: z.string().min(1).max(LIMITS.maxQueryChars) }).strict(),
  z
    .object({
      kind: z.literal('request'),
      request: z.discriminatedUnion('scenario', [
        z.object({ scenario: z.literal('place'), typeId: idSchema, zoneId: idSchema.nullable() }).strict(),
        z.object({ scenario: z.literal('equipment'), zoneId: idSchema.nullable() }).strict(),
        z.object({ scenario: z.literal('compare') }).strict(),
      ]),
      preference: z.string().max(LIMITS.maxQueryChars).nullable(),
    })
    .strict(),
]);

const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('focus'), ref: refSchema }).strict(),
  z.object({ kind: z.literal('open-properties'), objectId: idSchema }).strict(),
  z
    .object({
      kind: z.literal('filter-inventory'),
      typeId: idSchema.optional(),
      zoneId: idSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('show-layer'), layerId: idSchema }).strict(),
  z
    .object({
      kind: z.literal('preview-candidate'),
      recommendationId: idSchema,
      candidateId: idSchema,
    })
    .strict(),
]);

const selectionSchema = z
  .object({
    selections: z
      .array(
        z
          .object({
            recommendationId: idSchema,
            factIds: z.array(idSchema).min(1),
            actions: z.array(actionSchema),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

function issue(code: string, message: string, refs: Ref[] = []): Issue {
  return { code, severity: 'error', message, refs };
}

function malformed(error: z.ZodError): Result<never> {
  return {
    ok: false,
    issues: [
      issue(
        CHAT_ISSUE_CODES.SHAPE_INVALID,
        `Ответ модели не соответствует контракту чата: ${error.issues
          .map((entry) => `${entry.path.join('.') || '<корень>'} — ${entry.message}`)
          .join('; ')}.`,
      ),
    ],
  };
}

function refExists(plan: PlanDocument, ref: Ref): boolean {
  switch (ref.kind) {
    case 'room':
      return plan.room.id === ref.id;
    case 'zone':
      return plan.zones.some((zone) => zone.id === ref.id);
    case 'object':
      return plan.objects.some((object) => object.id === ref.id);
    case 'layer':
      return plan.layers.some((layer) => layer.id === ref.id);
    case 'wall':
      return plan.walls.some((wall) => wall.id === ref.id);
    case 'opening':
      return plan.openings.some((opening) => opening.id === ref.id);
  }
}

/** Verifies the first model call against the current plan vocabulary. */
export function verifyChatIntent(input: unknown, plan: PlanDocument): Result<ChatIntent> {
  const parsed = intentSchema.safeParse(input);
  if (!parsed.success) return malformed(parsed.error);

  const intent = parsed.data as ChatIntent;
  if (intent.kind === 'clarify') return { ok: true, value: intent };

  const issues: Issue[] = [];
  const request = intent.request;
  if ('typeId' in request) {
    const typeId = request.typeId;
    if (!plan.catalog.objectTypes.some((type) => type.id === typeId)) {
      issues.push(
        issue(
          CHAT_ISSUE_CODES.UNKNOWN_OBJECT_TYPE,
          `Тип оборудования «${typeId}» отсутствует в справочнике плана.`,
        ),
      );
    }
  }
  if ('zoneId' in request && request.zoneId !== null) {
    const zoneId = request.zoneId;
    if (!plan.zones.some((zone) => zone.id === zoneId)) {
      issues.push(
        issue(
          CHAT_ISSUE_CODES.UNKNOWN_ZONE,
          `Зона «${zoneId}» отсутствует в плане.`,
        ),
      );
    }
  }

  return issues.length === 0 ? { ok: true, value: intent } : { ok: false, issues };
}

function factsById(recommendation: Recommendation): Map<Id, Fact> {
  return new Map(recommendation.facts.map((fact) => [fact.id, fact]));
}

function candidateOwner(recommendation: Recommendation): Map<Id, Id> {
  const owners = new Map<Id, Id>();
  for (const candidate of recommendation.candidates) {
    for (const fact of candidate.facts) owners.set(fact.id, candidate.id);
  }
  return owners;
}

/**
 * Verifies the second model call. Every fact and candidate is owned by the
 * selected calculation; display actions may only target current plan entities.
 */
export function verifyChatSelection(
  input: unknown,
  recommendations: Recommendation[],
  plan: PlanDocument,
): Result<ChatSelection> {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return malformed(parsed.error);

  const byId = new Map(recommendations.map((recommendation) => [recommendation.id, recommendation]));
  const seen = new Set<Id>();
  const issues: Issue[] = [];

  for (const entry of parsed.data.selections) {
    const recommendation = byId.get(entry.recommendationId);
    if (recommendation === undefined) {
      issues.push(
        issue(
          CHAT_ISSUE_CODES.UNKNOWN_RECOMMENDATION,
          `Расчёт не выдавал рекомендацию «${entry.recommendationId}».`,
        ),
      );
      continue;
    }
    if (seen.has(entry.recommendationId)) {
      issues.push(
        issue(
          CHAT_ISSUE_CODES.DUPLICATE_RECOMMENDATION,
          `Рекомендация «${entry.recommendationId}» выбрана больше одного раза.`,
          recommendation.refs,
        ),
      );
      continue;
    }
    seen.add(entry.recommendationId);

    const facts = factsById(recommendation);
    const owners = candidateOwner(recommendation);
    const citedCandidateIds = new Set<Id>();
    for (const factId of entry.factIds) {
      if (!facts.has(factId)) {
        issues.push(
          issue(
            CHAT_ISSUE_CODES.UNKNOWN_FACT,
            `Факт «${factId}» не принадлежит рекомендации «${recommendation.id}».`,
            recommendation.refs,
          ),
        );
        continue;
      }
      const owner = owners.get(factId);
      if (owner !== undefined) citedCandidateIds.add(owner);
    }
    if (citedCandidateIds.size > 1) {
      issues.push(
        issue(
          CHAT_ISSUE_CODES.CANDIDATE_MISMATCH,
          `Выбраны факты разных вариантов рекомендации «${recommendation.id}».`,
          recommendation.refs,
        ),
      );
    }

    for (const action of entry.actions) {
      if (action.kind === 'focus') {
        if (!refExists(plan, action.ref)) {
          issues.push(
            issue(
              CHAT_ISSUE_CODES.UNKNOWN_REF,
              `Действие фокуса ссылается на отсутствующую сущность «${action.ref.id}».`,
              recommendation.refs,
            ),
          );
        } else if (action.ref.kind !== 'object' && action.ref.kind !== 'zone') {
          issues.push(
            issue(
              CHAT_ISSUE_CODES.ACTION_TARGET_NOT_ALLOWED,
              `Фокус разрешён только для объекта или зоны, не для «${action.ref.kind}».`,
              recommendation.refs,
            ),
          );
        }
      }
      if (
        action.kind === 'open-properties' &&
        !plan.objects.some((object) => object.id === action.objectId)
      ) {
        issues.push(
          issue(
            CHAT_ISSUE_CODES.UNKNOWN_OBJECT,
            `Свойства нельзя открыть: объекта «${action.objectId}» нет в плане.`,
            recommendation.refs,
          ),
        );
      }
      if (
        action.kind === 'filter-inventory' &&
        action.typeId !== undefined &&
        !plan.catalog.objectTypes.some((type) => type.id === action.typeId)
      ) {
        issues.push(
          issue(
            CHAT_ISSUE_CODES.UNKNOWN_OBJECT_TYPE,
            `Фильтр ссылается на отсутствующий тип «${action.typeId}».`,
            recommendation.refs,
          ),
        );
      }
      if (
        action.kind === 'filter-inventory' &&
        action.zoneId !== undefined &&
        !plan.zones.some((zone) => zone.id === action.zoneId)
      ) {
        issues.push(
          issue(
            CHAT_ISSUE_CODES.UNKNOWN_ZONE,
            `Фильтр ссылается на отсутствующую зону «${action.zoneId}».`,
            recommendation.refs,
          ),
        );
      }
      if (
        action.kind === 'show-layer' &&
        !plan.layers.some((layer) => layer.id === action.layerId)
      ) {
        issues.push(
          issue(
            CHAT_ISSUE_CODES.UNKNOWN_LAYER,
            `Слой «${action.layerId}» отсутствует в плане.`,
            recommendation.refs,
          ),
        );
      }
      if (action.kind === 'preview-candidate') {
        const candidate = recommendation.candidates.find(
          (entry) => entry.id === action.candidateId,
        );
        if (action.recommendationId !== recommendation.id || candidate === undefined) {
          issues.push(
            issue(
              CHAT_ISSUE_CODES.CANDIDATE_MISMATCH,
              `Вариант «${action.candidateId}» не принадлежит рекомендации «${recommendation.id}».`,
              recommendation.refs,
            ),
          );
        } else if (
          citedCandidateIds.size === 1 &&
          !citedCandidateIds.has(action.candidateId)
        ) {
          issues.push(
            issue(
              CHAT_ISSUE_CODES.CANDIDATE_MISMATCH,
              `Факты выбраны для другого варианта, не «${action.candidateId}».`,
              recommendation.refs,
            ),
          );
        }
      }
    }
  }

  return issues.length === 0
    ? { ok: true, value: parsed.data as ChatSelection }
    : { ok: false, issues };
}
