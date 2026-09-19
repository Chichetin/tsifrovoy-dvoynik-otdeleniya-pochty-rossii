import { describe, expect, test } from 'vitest';
import type { AdviceHttpRequest } from '../../contracts/advice';
import minimal from '../../contracts/fixtures/minimal.json';
import { parsePlanDocument } from '../../contracts/schema';
import { requestAdvice } from './advice-client';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('Контрактный fixture minimal.json не разобрался');

const input: AdviceHttpRequest = {
  plan: parsed.value,
  revision: 7,
  request: { scenario: 'place', typeId: 'ot_workplace', zoneId: 'z_client' },
};

test('429 с issues сохраняет рассчитанные рекомендации в режиме без LLM', async () => {
  let calls = 0;
  const fetchStub: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ issues: [{ code: 'LLM_HTTP_ERROR', message: 'Лимит' }] }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await requestAdvice(input, fetchStub);

  expect(calls).toBe(1);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.mode).toBe('fallback');
  expect(result.value.fallbackReason).toContain('429');
  expect(result.value.revision).toBe(7);
  expect(result.value.recommendations.length).toBeGreaterThan(0);
  expect(result.value.explanations.length).toBeGreaterThan(0);
});

test('ошибка структуры плана остаётся ошибкой, не маскируется fallback', async () => {
  const fetchStub: typeof fetch = async () =>
    new Response(JSON.stringify({ issues: [{ code: 'PLAN_INVALID', severity: 'error', message: 'План неверен', refs: [] }] }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });

  const result = await requestAdvice(input, fetchStub);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues[0]?.code).toBe('PLAN_INVALID');
});

describe('причина «без модели» написана для сотрудника, код — в скобках для разработчика', () => {
  const status = (code: number): typeof fetch => async () =>
    new Response('Bad Gateway', { status: code, headers: { 'content-type': 'text/plain' } });

  test('502: сервер не ответил — показан расчёт', async () => {
    const result = await requestAdvice(input, status(502));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = result.value.fallbackReason ?? '';
    expect(reason).not.toContain('ответил 502');
    expect(reason).toContain('Модель сейчас недоступна');
    expect(reason).toContain('показан расчёт');
    expect(reason).toMatch(/\(код 502\)\.$/);
  });

  test('сеть не дошла до сервера', async () => {
    const result = await requestAdvice(input, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fallbackReason).toContain('Сервер ассистента не отвечает');
    expect(result.value.fallbackReason).toContain('показан расчёт');
  });

  test('непонятный ответ — ошибка с советом, а не молчаливый успех', async () => {
    const result = await requestAdvice(input, async () =>
      new Response(JSON.stringify({ hello: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('Повторите запрос');
    expect(result.issues[0]?.message).toMatch(/\(код 200\)/);
  });
});
