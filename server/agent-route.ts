/**
 * D-258: POST /api/assistant/agent — the conversational plan agent.
 *
 * The answer streams as NDJSON: every tool call is written the moment it runs,
 * so the person watches the agent work instead of a spinner, and the last line
 * is the answer. Without a provider, over the rate limit or on any model
 * failure the same stream carries the calculation's own answer, «без LLM».
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { agentBodySchema, type AgentStep, type AgentStreamEvent } from '../src/contracts/advice-chat';
import { parsePlanDocument } from '../src/contracts/schema';
import { answerWithoutModel } from '../src/domain/advice';
import { createLimiter } from './advice-route';
import { runAgent } from './agent';
import type { LlmChat } from './llm-client';

export type AgentRouteOptions = {
  chat: LlmChat | null;
  rateLimit: { max: number; windowMs: number };
  deadlineMs: number;
  /** #137: one model call's timeout; the page waits this long plus a margin. Null — no model. */
  llmTimeoutMs?: number | null;
};

/** The header that names `llmTimeoutMs` on the agent's stream. */
export const LLM_TIMEOUT_HEADER = 'x-llm-timeout-ms';

export function registerAgentRoute(app: FastifyInstance, options: AgentRouteOptions): void {
  const allow = createLimiter(options.rateLimit);

  app.post('/api/assistant/agent', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = agentBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        issues: [
          {
            code: 'REQUEST_INVALID',
            severity: 'error',
            message: `Запрос ассистенту не соответствует контракту: ${body.error.issues
              .map((entry) => `${entry.path.join('.') || '<корень>'} — ${entry.message}`)
              .join('; ')}.`,
            refs: [],
          },
        ],
      });
    }
    const plan = parsePlanDocument(body.data.plan);
    if (!plan.ok) return reply.code(400).send({ issues: plan.issues });
    let before = null;
    if (body.data.before !== undefined) {
      const parsed = parsePlanDocument(body.data.before);
      if (!parsed.ok) return reply.code(400).send({ issues: parsed.issues });
      before = parsed.value;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      ...(options.llmTimeoutMs == null ? {} : { [LLM_TIMEOUT_HEADER]: String(options.llmTimeoutMs) }),
    });
    const send = (event: AgentStreamEvent): void => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    const onStep = (step: AgentStep): void => send({ type: 'step', step });
    const { query, history, revision } = body.data;

    try {
      const answer =
        options.chat === null
          ? answerWithoutModel(plan.value, before, query, revision, 'Провайдер модели не настроен — ответ собран расчётом без LLM.', onStep)
          : !allow()
            ? answerWithoutModel(plan.value, before, query, revision, 'Превышен лимит обращений к модели — ответ собран расчётом без LLM.', onStep)
            : await runAgent({ chat: options.chat, plan: plan.value, before, query, history, revision, onStep, deadlineMs: options.deadlineMs });
      send({ type: 'answer', answer });
    } catch (error) {
      request.log.error({ err: error }, 'agent failed');
      send({
        type: 'error',
        issues: [{ code: 'AGENT_FAILED', severity: 'error', message: 'Ассистент не смог собрать ответ.', refs: [] }],
      });
    }
    reply.raw.end();
  });
}
