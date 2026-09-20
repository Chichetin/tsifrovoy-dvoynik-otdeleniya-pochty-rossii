/**
 * A05: POST /api/advice and GET /api/health.
 *
 * The route calculates first and asks the model second. Whatever happens to the
 * model — missing key, timeout, rate limit, nonsense instead of JSON, an answer
 * that does not survive A04 — the response still carries the calculated
 * recommendations, with `mode: 'fallback'` and a reason in plain Russian. An
 * empty screen is a defect, so there is no path here that produces one.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  AdviceHttpRequest,
  AdviceRequest,
  AdviceResponse,
  HealthResponse,
  Recommendation,
} from '../src/contracts/advice';
import type { Issue, PlanDocument } from '../src/contracts/model';
import { LIMITS } from '../src/contracts/model';
import { parsePlanDocument } from '../src/contracts/schema';
import { REASON_CODE_SPECS } from '../src/contracts/advice-semantics';
import { calculateAdvice, defaultExplanation, verifyExplanation } from '../src/domain/advice';
import { LLM_ISSUE_CODES, type LlmClient } from './llm-client';

export type AdviceRouteOptions = {
  /** null means the server runs without a provider — a supported mode. */
  llm: LlmClient | null;
  /** Shown in the fallback reason so the demo says which provider was tried. */
  llmLabel: string | null;
  /**
   * What health may say publicly: the provider's name only. The model URI can
   * carry the cloud folder id, and that stays on the server with the key.
   */
  llmProvider: string | null;
  rateLimit: { max: number; windowMs: number };
};

const requestSchema = z.discriminatedUnion('scenario', [
  z.object({
    scenario: z.literal('place'),
    typeId: z.string().min(1),
    zoneId: z.string().min(1).nullable(),
    anchor: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  }),
  z.object({ scenario: z.literal('equipment'), zoneId: z.string().min(1).nullable() }),
  z.object({ scenario: z.literal('compare'), before: z.unknown() }),
]);

const bodySchema = z.object({
  plan: z.unknown(),
  revision: z.number().int().min(0),
  request: requestSchema,
  query: z.string().max(LIMITS.maxQueryChars).optional(),
});

function badRequest(reply: FastifyReply, issues: Issue[]): FastifyReply {
  return reply.code(400).send({ issues });
}

/**
 * What the model is allowed to see: ids, codes and numbers that already exist.
 * The plan itself is not sent — the model has nothing to do with it, and a
 * smaller prompt is a cheaper prompt.
 */
function promptPayload(recommendations: Recommendation[]): unknown {
  return recommendations.map((recommendation) => ({
    id: recommendation.id,
    scenario: recommendation.scenario,
    reasonCodes: recommendation.reasonCodes,
    // The same rules the answer is checked against (D-206): which facts a
    // reason code must cite and whether it names a candidate. Left to guess,
    // the model cited a subset and the check rightly threw the answer away.
    rules: recommendation.reasonCodes.map((code) => ({
      code,
      candidate: REASON_CODE_SPECS[code].candidate,
      requiredFacts: REASON_CODE_SPECS[code].requiredFacts.map((fact) => `${fact.metric}/${fact.phase}`),
    })),
    candidates: recommendation.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.object.label,
      position: candidate.object.position,
      size_m: candidate.object.size_m,
      rotation_deg: candidate.object.rotation_deg,
      factIds: candidate.facts.map((fact) => fact.id),
    })),
    facts: recommendation.facts.map((fact) => ({
      id: fact.id,
      metric: fact.metric,
      phase: fact.phase,
      value: fact.value,
      unit: fact.unit,
    })),
  }));
}

const SYSTEM_PROMPT = [
  'Ты помощник планировщика отделения Почты России.',
  'Тебе дают уже выполненный расчёт. Числа считать, проверять и исправлять нельзя.',
  'Твоя задача — выбрать для каждой рекомендации один код причины из её reasonCodes,',
  'при необходимости один вариант размещения из её candidates и перечислить id фактов,',
  'которые этот выбор подтверждают.',
  'У каждого кода в rules перечислены requiredFacts как «metric/phase»: factIds обязаны',
  'содержать все факты рекомендации и выбранного варианта с такими metric и phase —',
  'ответ без любого из них отклоняется. candidate: required — вариант назвать обязательно,',
  'forbidden — candidateId должен быть null.',
  'Ответ — строго JSON вида {"explanations":[{"recommendationId":"...","candidateId":null,',
  '"reasonCode":"...","factIds":["..."]}]}. Никаких других полей, комментариев и текста.',
  'Любое собственное число или поле делает ответ недействительным.',
].join(' ');

function userPrompt(recommendations: Recommendation[], query: string | undefined): string {
  const question = query === undefined ? '' : `\n\nВопрос пользователя: ${query}`;
  return `Рекомендации расчёта:\n${JSON.stringify(promptPayload(recommendations), null, 1)}${question}`;
}

/** A window counter. Enough to keep one demo from burning the whole balance. */
function createLimiter(rateLimit: { max: number; windowMs: number }): () => boolean {
  let windowStart = 0;
  let used = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= rateLimit.windowMs) {
      windowStart = now;
      used = 0;
    }
    used += 1;
    return used <= rateLimit.max;
  };
}

function fallbackResponse(
  revision: number,
  recommendations: Recommendation[],
  reason: string,
): AdviceResponse {
  // Расчёт объясняет сам себя: те же коды, те же факты, та же проверка.
  const explanations = recommendations
    .map((recommendation) => defaultExplanation(recommendation))
    .filter((explanation) => explanation !== null);
  return { revision, recommendations, explanations, mode: 'fallback', fallbackReason: reason };
}

export function registerAdviceRoutes(app: FastifyInstance, options: AdviceRouteOptions): void {
  const allow = createLimiter(options.rateLimit);

  // Health says whether a provider is configured — the reviewer can see on the
  // deployed address which mode the assistant will answer in, without a key
  // ever leaving the server: only the provider/model label travels.
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    llm:
      options.llm === null || options.llmProvider === null
        ? { configured: false }
        : { configured: true, provider: options.llmProvider },
  }));

  app.post('/api/advice', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = bodySchema.safeParse(request.body);
    if (!body.success) {
      return badRequest(reply, [
        {
          code: 'REQUEST_INVALID',
          severity: 'error',
          message: `Запрос не соответствует контракту: ${body.error.issues
            .map((entry) => `${entry.path.join('.') || '<корень>'} — ${entry.message}`)
            .join('; ')}.`,
          refs: [],
        },
      ]);
    }

    const plan = parsePlanDocument(body.data.plan);
    if (!plan.ok) return badRequest(reply, plan.issues);

    let adviceRequest: AdviceRequest;
    if (body.data.request.scenario === 'compare') {
      const before = parsePlanDocument(body.data.request.before);
      if (!before.ok) return badRequest(reply, before.issues);
      adviceRequest = { scenario: 'compare', before: before.value };
    } else {
      adviceRequest = body.data.request;
    }

    const calculated = calculateAdvice(plan.value, adviceRequest);
    // 422: геометрию плана посчитать нельзя — это про план, а не про запрос.
    if (!calculated.ok) return reply.code(422).send({ issues: calculated.issues });

    const recommendations = calculated.value;
    const revision = body.data.revision;

    if (options.llm === null) {
      return fallbackResponse(
        revision,
        recommendations,
        'Провайдер модели не настроен: показан расчёт без объяснения модели.',
      );
    }
    if (recommendations.length === 0) {
      return fallbackResponse(
        revision,
        recommendations,
        'Расчёту нечего объяснять: рекомендаций нет.',
      );
    }
    if (!allow()) {
      return reply.code(429).send({
        issues: [
          {
            code: LLM_ISSUE_CODES.LLM_HTTP_ERROR,
            severity: 'error',
            message: 'Превышен лимит обращений к ассистенту на этом сервере. Повторите позже.',
            refs: [],
          },
        ],
      });
    }

    const answer = await options.llm({
      system: SYSTEM_PROMPT,
      user: userPrompt(recommendations, body.data.query),
    });
    if (!answer.ok) {
      request.log.warn({ issues: answer.issues.map((entry) => entry.code) }, 'llm call failed');
      // «Недоступна» — про сеть и статус; пустой ответ модели — другая история.
      const empty = answer.issues[0]?.code === LLM_ISSUE_CODES.LLM_EMPTY_CONTENT;
      return fallbackResponse(
        revision,
        recommendations,
        `${empty ? 'Модель ответила без текста' : 'Модель недоступна'} (${options.llmLabel ?? 'провайдер'}): ${answer.issues[0]?.message ?? 'нет ответа'}`,
      );
    }

    const verified = verifyExplanation(answer.value, recommendations);
    if (!verified.ok) {
      request.log.warn(
        { issues: verified.issues.map((entry) => entry.code) },
        'llm answer rejected',
      );
      return fallbackResponse(
        revision,
        recommendations,
        `Ответ модели не прошёл проверку (${verified.issues.map((entry) => entry.code).join(', ')}): показан расчёт.`,
      );
    }

    const response: AdviceResponse = {
      revision,
      recommendations,
      explanations: verified.value,
      mode: 'llm',
    };
    return response;
  });
}

/** Re-exported for the tests and for `main.ts`. */
export type { AdviceHttpRequest, AdviceResponse, PlanDocument };
