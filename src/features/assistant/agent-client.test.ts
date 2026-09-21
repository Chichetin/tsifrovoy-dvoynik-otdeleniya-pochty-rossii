/**
 * D-236: the browser transport of the agent — the NDJSON stream, the local
 * answer when there is no server, and the context limits.
 */
import { describe, expect, test } from 'vitest';
import { AGENT_LIMITS, type AgentAnswer, type AgentStep } from '../../contracts/advice-chat';
import minimal from '../../contracts/fixtures/minimal.json';
import { parsePlanDocument } from '../../contracts/schema';
import { requestAgent, turnsOf } from './agent-client';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const input = { plan: parsed.value, revision: 5, query: 'Что с планом?', history: [] };

const serverAnswer: AgentAnswer = { revision: 5, mode: 'llm', text: 'Всё в порядке.', steps: [], recommendations: [], actions: [], refs: [] };

function streamed(chunks: string[], status = 200): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
      { status, headers: { 'content-type': 'application/x-ndjson' } },
    );
}

describe('requestAgent', () => {
  test('шаги приходят по мере работы, строка может быть разрезана между кусками', async () => {
    const steps: AgentStep[] = [];
    const step = JSON.stringify({ type: 'step', step: { tool: 'plan_overview', label: 'Сводка', ok: true } });
    const final = JSON.stringify({ type: 'answer', answer: serverAnswer });
    const result = await requestAgent(input, (entry) => steps.push(entry), streamed([step.slice(0, 10), `${step.slice(10)}\n${final.slice(0, 5)}`, `${final.slice(5)}\n`]));
    expect(steps.map((entry) => entry.label)).toEqual(['Сводка']);
    expect(result).toEqual({ ok: true, value: serverAnswer });
  });

  test('ошибка в потоке — честная ошибка, не успех', async () => {
    const issues = [{ code: 'AGENT_FAILED', severity: 'error', message: 'Сбой.', refs: [] }];
    const result = await requestAgent(input, () => undefined, streamed([`${JSON.stringify({ type: 'error', issues })}\n`]));
    expect(result).toEqual({ ok: false, issues });
  });

  test('сервера нет — отвечает расчёт в браузере с причиной', async () => {
    const steps: AgentStep[] = [];
    const result = await requestAgent(input, (entry) => steps.push(entry), async () => new Response('', { status: 404 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe('fallback');
    expect(result.value.revision).toBe(5);
    expect(result.value.fallbackReason).toContain('в браузере');
    expect(steps.length).toBeGreaterThan(0);
    const offline = await requestAgent(input, () => undefined, async () => {
      throw new TypeError('network');
    });
    expect(offline.ok && offline.value.mode).toBe('fallback');
  });

  test('400 с issues — ошибка запроса показана как есть', async () => {
    const issues = [{ code: 'REQUEST_INVALID', severity: 'error', message: 'Неверный запрос.', refs: [] }];
    const result = await requestAgent(input, () => undefined, async () => Response.json({ issues }, { status: 400 }));
    expect(result).toEqual({ ok: false, issues });
  });

  test('поток оборвался без ответа — ошибка, а не пустота', async () => {
    const result = await requestAgent(input, () => undefined, streamed(['{"type":"step","step":{"tool":"plan_overview","label":"x","ok":true}}\n']));
    expect(result.ok).toBe(false);
  });
});

describe('turnsOf', () => {
  test('в контекст идут только ответы, не больше предела по числу и размеру', () => {
    const long = 'а'.repeat(1_500);
    const exchanges = Array.from({ length: 6 }, (_, index) => ({
      question: `Вопрос ${index}`,
      revision: 0,
      answer: index === 5 ? null : { ...serverAnswer, text: long },
    }));
    const turns = turnsOf(exchanges);
    expect(turns.length).toBeLessThanOrEqual(AGENT_LIMITS.maxTurns);
    expect(turns.reduce((sum, turn) => sum + turn.text.length, 0)).toBeLessThanOrEqual(AGENT_LIMITS.maxHistoryChars);
    expect(turns[0]?.role).toBe('user');
    expect(turns.some((turn) => turn.text === 'Вопрос 5')).toBe(false);
  });
});
