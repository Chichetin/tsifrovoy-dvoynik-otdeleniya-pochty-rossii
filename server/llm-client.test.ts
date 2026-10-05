/**
 * A05: клиент провайдера на подставном fetch. Сеть не нужна: проверяется,
 * как ответы разной формы превращаются в Result — в том числе ответ
 * рассуждающей модели, которая потратила все токены на reasoning_content и
 * прислала content: null (так отвечает DeepSeek-V4-Flash при малом лимите).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { LLM_ISSUE_CODES, createLlmClient } from './llm-client';

const config = {
  provider: 'test-provider',
  endpoint: 'https://example.invalid/v1/chat/completions',
  model: 'test-model',
  apiKey: 'not-a-real-key',
  timeoutMs: 1_000,
  maxOutputTokens: 20,
};

function answering(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('A05: клиент провайдера', () => {
  test('текст ответа возвращается как есть', async () => {
    answering({ choices: [{ message: { content: '{"explanations":[]}' }, finish_reason: 'stop' }] });
    const result = await createLlmClient(config)({ system: 's', user: 'u' });
    expect(result).toEqual({ ok: true, value: '{"explanations":[]}' });
  });

  test('content: null при finish_reason length — понятный отказ про лимит токенов', async () => {
    answering({
      choices: [{ message: { content: null, reasoning_content: '1. Deconstruct…' }, finish_reason: 'length' }],
    });
    const result = await createLlmClient(config)({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe(LLM_ISSUE_CODES.LLM_EMPTY_CONTENT);
    expect(result.issues[0]?.message).toContain('LLM_MAX_OUTPUT_TOKENS');
    expect(result.issues[0]?.message).toContain('20 токенов');
  });

  test('пустая строка без причины — тоже отказ, но без совета про лимит', async () => {
    answering({ choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] });
    const result = await createLlmClient(config)({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe(LLM_ISSUE_CODES.LLM_EMPTY_CONTENT);
    expect(result.issues[0]?.message).not.toContain('LLM_MAX_OUTPUT_TOKENS');
  });

  test('не та форма тела — LLM_BODY_UNEXPECTED, статус не 2xx — LLM_HTTP_ERROR', async () => {
    answering({ result: 'unexpected' });
    const shape = await createLlmClient(config)({ system: 's', user: 'u' });
    expect(!shape.ok && shape.issues[0]?.code).toBe(LLM_ISSUE_CODES.LLM_BODY_UNEXPECTED);
    answering({ error: 'quota' }, 429);
    const http = await createLlmClient(config)({ system: 's', user: 'u' });
    expect(!http.ok && http.issues[0]?.code).toBe(LLM_ISSUE_CODES.LLM_HTTP_ERROR);
  });

  test('ключ уходит только в заголовок Authorization и не попадает в текст отказа', async () => {
    answering({ error: 'quota' }, 401);
    const client = createLlmClient(config);
    const result = await client({ system: 's', user: 'u' });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer not-a-real-key');
    expect(JSON.stringify(result)).not.toContain('not-a-real-key');
  });
});
