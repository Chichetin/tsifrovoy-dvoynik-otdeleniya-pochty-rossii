/**
 * A05: живой прогон провайдера. Пропускается, пока в окружении нет ключа, —
 * поэтому он не тратит баланс на CI и не делает сборку зависимой от сети.
 *
 * Запуск (ключ берётся из .env, в репозиторий он не попадает):
 *   LLM_PROVIDER=… LLM_ENDPOINT=… LLM_MODEL=… LLM_API_KEY=… npm test -- server/llm-smoke.test.ts
 *
 * Прогон печатает провайдера, модель и дату — это и есть запись о проверке,
 * которую человек переносит в HANDOFF.md. Утверждать «работает с настоящим
 * провайдером» без этой строки нельзя.
 */

import { describe, expect, test } from 'vitest';
import type { Recommendation } from '../src/contracts/advice';
import { REASON_CODE_SPECS } from '../src/contracts/advice-semantics';
import { verifyExplanation } from '../src/domain/advice';
import { readLlmConfig } from './config';
import { createLlmClient } from './llm-client';

const config = readLlmConfig(process.env);

const recommendation: Recommendation = {
  id: 'rec_smoke',
  scenario: 'equipment',
  refs: [{ kind: 'zone', id: 'z_waiting' }],
  candidates: [],
  facts: [
    {
      id: 'f_count',
      metric: 'equipment.count',
      phase: 'current',
      value: 1,
      unit: 'count',
      refs: [{ kind: 'zone', id: 'z_waiting' }],
    },
    {
      id: 'f_min',
      metric: 'equipment.min',
      phase: 'current',
      value: 2,
      unit: 'count',
      refs: [{ kind: 'zone', id: 'z_waiting' }],
    },
  ],
  ruleIds: ['rule_bench_min'],
  assumptions: ['Правило команды: в зоне ожидания не меньше двух мест ожидания.'],
  reasonCodes: ['equipment.missing'],
  limitations: [REASON_CODE_SPECS['equipment.missing'].requiredLimitation],
  changes: [],
};

describe.skipIf(config === null)('A05: живой прогон провайдера', () => {
  test('модель отвечает выбором, который проходит проверку', async () => {
    if (config === null) return;
    const client = createLlmClient(config);

    const answer = await client({
      system:
        'Ответ — строго JSON вида {"explanations":[{"recommendationId":"...","candidateId":null,' +
        '"reasonCode":"...","factIds":["..."]}]}. Числа не считай и полей не добавляй.',
      user: `Рекомендации расчёта:\n${JSON.stringify([recommendation], null, 1)}`,
    });

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;

    const verified = verifyExplanation(answer.value, [recommendation]);
    // Печать — это и есть запись о прогоне, её переносят в HANDOFF.md.
    console.log(
      `живой прогон: провайдер ${config.provider}, модель ${config.model}, ` +
        `${new Date().toISOString().slice(0, 10)}, ответ ${verified.ok ? 'прошёл проверку' : 'отклонён: ' + verified.issues.map((issue) => issue.code).join(', ')}`,
    );
    expect(verified.ok).toBe(true);
  }, 60_000);
});
