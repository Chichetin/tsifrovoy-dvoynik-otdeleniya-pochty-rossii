/**
 * D-258: the agent loop and its route with a scripted model. The provider is
 * replaced by a list of turns, so every branch — tools, the text check, the one
 * repair, the fallback — is exercised without a network.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import type { AgentAnswer, AgentStep, AgentStreamEvent } from '../src/contracts/advice-chat';
import type { PlanDocument } from '../src/contracts/model';
import { parsePlanDocument } from '../src/contracts/schema';
import { calculateAdvice } from '../src/domain/advice';
import { runAgent } from './agent';
import { registerAgentRoute } from './agent-route';
import type { LlmChat, LlmMessage, LlmTurn } from './llm-client';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')));
  if (!parsed.ok) throw new Error(`${path} не разобрался`);
  return parsed.value;
}

const plan = load('demo/before.json');
const placement = calculateAdvice(plan, { scenario: 'place', typeId: 'ot_workplace', zoneId: null });
if (!placement.ok) throw new Error('расчёт места не удался');
const recommendation = placement.value[0]!;
const candidate = recommendation.candidates[0]!;
const freeAfter = candidate.facts.find((fact) => fact.metric === 'area.free' && fact.phase === 'after')!.value;

function call(name: string, args: unknown, id = name): LlmTurn['toolCalls'][number] {
  return { id, name, arguments: JSON.stringify(args) };
}

/** Plays the given turns in order and records every conversation it was shown. */
function scripted(turns: (LlmTurn | 'fail')[]): { chat: LlmChat; seen: LlmMessage[][] } {
  const seen: LlmMessage[][] = [];
  const chat: LlmChat = async ({ messages }) => {
    seen.push(structuredClone(messages));
    const next = turns.shift();
    if (next === undefined || next === 'fail') {
      return { ok: false, issues: [{ code: 'LLM_TIMEOUT', severity: 'error', message: 'нет ответа.', refs: [] }] };
    }
    return { ok: true, value: next };
  };
  return { chat, seen };
}

function run(chat: LlmChat, query = 'Где добавить рабочее место?'): Promise<{ answer: AgentAnswer; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  return runAgent({ chat, plan, before: null, query, history: [], revision: 7, onStep: (step) => steps.push(step), deadlineMs: 60_000 }).then(
    (answer) => ({ answer, steps }),
  );
}

const placeTurns = (): LlmTurn[] => [
  { content: '', toolCalls: [call('find_place', { typeId: 'ot_workplace', zoneId: null })] },
  { content: '', toolCalls: [call('suggest_candidate', { recommendationId: recommendation.id, candidateId: candidate.id })] },
];

describe('цикл агента', () => {
  test('инструменты → проверенный текст модели → действия и кнопка «Применить»', async () => {
    const free = String(Math.round(freeAfter * 10) / 10).replace('.', ',');
    const { chat, seen } = scripted([...placeTurns(), { content: `Лучшее место — в зоне ${candidate.object.zoneId}; свободно останется ${free} м².`, toolCalls: [] }]);
    const { answer, steps } = await run(chat);
    expect(answer.mode).toBe('llm');
    expect(answer.revision).toBe(7);
    expect(steps.map((step) => step.tool)).toEqual(['find_place', 'suggest_candidate']);
    expect(answer.actions).toContainEqual({ kind: 'apply-candidate', recommendationId: recommendation.id, candidateId: candidate.id });
    expect(answer.recommendations.map((entry) => entry.id)).toEqual([recommendation.id]);
    // The model saw the tool result before it wrote the answer.
    expect(seen[1]!.some((message) => message.role === 'tool' && message.content.includes(candidate.id))).toBe(true);
  });

  test('выдуманное число: одна попытка исправиться, и исправленный текст принят', async () => {
    const { chat, seen } = scripted([...placeTurns(), { content: 'Свободно останется 512 м².', toolCalls: [] }, { content: 'Место найдено, вариант показан на плане.', toolCalls: [] }]);
    const { answer } = await run(chat);
    expect(answer.mode).toBe('llm');
    expect(answer.text).toBe('Место найдено, вариант показан на плане.');
    const repairNote = seen[3]!.at(-1)!;
    expect(repairNote.role).toBe('user');
    expect(repairNote.content).toContain('512');
  });

  test('выдуманное число дважды — показан текст расчёта с причиной', async () => {
    const { chat } = scripted([...placeTurns(), { content: 'Свободно 512 м².', toolCalls: [] }, { content: 'Свободно 513 м².', toolCalls: [] }]);
    const { answer } = await run(chat);
    expect(answer.mode).toBe('fallback');
    expect(answer.fallbackReason).toContain('513');
    expect(answer.text).not.toContain('513');
    // The tools already ran: their result and the offered variant survive the fallback.
    expect(answer.actions.some((action) => action.kind === 'apply-candidate')).toBe(true);
  });

  test('провайдер недоступен с первого вызова — ответ расчёта по той же фразе', async () => {
    const { chat } = scripted(['fail']);
    const { answer, steps } = await run(chat);
    expect(answer.mode).toBe('fallback');
    expect(answer.fallbackReason).toContain('Модель недоступна');
    expect(steps[0]?.tool).toBe('find_place');
    expect(answer.recommendations[0]?.scenario).toBe('place');
  });

  test('модель зовёт инструмент записи — отказ приходит ей как ошибка, план не меняется', async () => {
    const snapshot = JSON.stringify(plan);
    const { chat, seen } = scripted([
      { content: '', toolCalls: [call('object_put', { id: 'eq_1' })] },
      { content: 'Менять план я не могу.', toolCalls: [] },
    ]);
    const { answer } = await run(chat);
    expect(answer.mode).toBe('llm');
    expect(seen[1]!.at(-1)!.content).toContain('error');
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  test('бесконечные вызовы инструментов обрываются пределом шагов', async () => {
    const turns = Array.from({ length: 10 }, (_, index): LlmTurn => ({ content: '', toolCalls: [call('plan_overview', {}, `c${index}`)] }));
    const { chat, seen } = scripted(turns);
    const { answer } = await run(chat);
    expect(answer.mode).toBe('fallback');
    expect(seen).toHaveLength(6);
  });
});

describe('POST /api/assistant/agent', () => {
  async function post(body: unknown, chat: LlmChat | null = null): Promise<{ status: number; events: AgentStreamEvent[]; raw: string }> {
    const app = Fastify();
    registerAgentRoute(app, { chat, rateLimit: { max: 10, windowMs: 60_000 }, deadlineMs: 60_000 });
    const response = await app.inject({ method: 'POST', url: '/api/assistant/agent', payload: body as object });
    await app.close();
    const events = response.statusCode === 200 ? response.body.trim().split('\n').map((line) => JSON.parse(line) as AgentStreamEvent) : [];
    return { status: response.statusCode, events, raw: response.body };
  }

  test('без провайдера: шаги потоком, затем один ответ расчёта', async () => {
    const { status, events } = await post({ plan, revision: 3, query: 'Где поставить кассовое окно?', history: [] });
    expect(status).toBe(200);
    expect(events.at(-1)?.type).toBe('answer');
    expect(events.slice(0, -1).every((event) => event.type === 'step')).toBe(true);
    const answer = (events.at(-1) as { answer: AgentAnswer }).answer;
    expect(answer.mode).toBe('fallback');
    expect(answer.revision).toBe(3);
  });

  test('с провайдером: ответ модели в том же потоке', async () => {
    const { chat } = scripted([{ content: '', toolCalls: [call('plan_overview', {})] }, { content: 'План открыт, ошибки смотрите во вкладке «Проверка».', toolCalls: [] }]);
    const { events } = await post({ plan, revision: 0, query: 'Что с планом?', history: [] }, chat);
    expect(events.map((event) => event.type)).toEqual(['step', 'answer']);
    expect((events[1] as { answer: AgentAnswer }).answer.mode).toBe('llm');
  });

  test('неверный запрос и неверный план — 400 без потока', async () => {
    expect((await post({ plan, revision: 0, query: '' })).status).toBe(400);
    expect((await post({ plan: { nope: true }, revision: 0, query: 'Привет' })).status).toBe(400);
  });
});

test('вывод, сказанный рядом с вызовами инструментов, входит в ответ', async () => {
  const { chat } = scripted([
    { content: 'Не хватает второй скамьи.', toolCalls: [call('plan_overview', {})] },
    { content: 'Вариант показан на плане.', toolCalls: [] },
  ]);
  const { answer } = await run(chat, 'Чего не хватает?');
  expect(answer.text).toBe('Не хватает второй скамьи.\n\nВариант показан на плане.');
});

test('план изменили после прошлого ответа — модель получает об этом пометку', async () => {
  const { chat, seen } = scripted([{ content: 'Готово.', toolCalls: [] }]);
  await runAgent({
    chat, plan, before: null, query: 'Сколько теперь свободно?', revision: 8, onStep: () => undefined, deadlineMs: 60_000,
    history: [{ role: 'user', text: 'Где место?', revision: 7 }, { role: 'assistant', text: 'Вариант показан.', revision: 7 }],
  });
  expect(seen[0]!.at(-1)!.content).toContain('план изменили');
  expect(seen[0]!.filter((message) => message.role === 'assistant')).toHaveLength(1);
});
