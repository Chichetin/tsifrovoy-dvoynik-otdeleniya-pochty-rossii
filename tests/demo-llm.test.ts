/**
 * E01-llm: the demo set records the assistant's mode honestly.
 *
 * The builder goes to the model the same way the app does — through the
 * `/api/advice` route with the provider read from the environment — so these
 * tests stand up a fake OpenAI-compatible provider on a local port instead of
 * stubbing anything inside the builder. No key and no network are needed. What
 * is proven: a valid answer gives `mode: 'llm'` with the calculated numbers
 * untouched; garbage, an HTTP error and a missing key give `mode: 'fallback'`
 * with a reason, never silently.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  buildDemo,
  buildDemoFromEnv,
  collectModelExplanations,
  NO_PROVIDER_REASON,
  publicModelName,
  rebuildFromFile,
  renderModeSection,
  withModeSection,
  type DemoRecommendationFile,
} from '../demo/build';
import type { AdviceResponse, Explanation } from '../src/contracts/advice';
import { verifyExplanation } from '../src/domain/advice';

type PromptRecommendation = {
  id: string;
  reasonCodes: string[];
  candidates: { id: string; factIds: string[] }[];
  facts: { id: string }[];
};

/** Reads the recommendations the route put into the user message. */
function promptOf(body: string): PromptRecommendation[] {
  const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
  const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
  return JSON.parse(user.slice(user.indexOf('['), user.lastIndexOf(']') + 1)) as PromptRecommendation[];
}

/**
 * A model that chooses honestly: the first allowed reason, the first candidate,
 * its own facts plus the shared ones. It chooses the first candidate even when
 * the calculation's default would be another, so an llm build is visibly the
 * model's choice and not the template copied.
 */
function honestAnswer(prompt: PromptRecommendation[], variant = 0): string {
  return JSON.stringify({
    explanations: prompt.map((recommendation) => {
      const candidate = recommendation.candidates[variant] ?? recommendation.candidates[0];
      const own = new Set(candidate?.factIds ?? []);
      const factIds = recommendation.facts
        .filter(
          (fact) =>
            own.has(fact.id) ||
            recommendation.candidates.every((entry) => !entry.factIds.includes(fact.id)),
        )
        .map((fact) => fact.id);
      return {
        recommendationId: recommendation.id,
        candidateId: candidate?.id ?? null,
        reasonCode: recommendation.reasonCodes[0],
        factIds,
      };
    }),
  });
}

type Provider = {
  env: Record<string, string>;
  calls: { authorization: string | undefined; model: string }[];
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => resolve(body));
  });
}

/** A local OpenAI-compatible endpoint whose content is decided by `answer`. */
async function provider(
  answer: (prompt: PromptRecommendation[]) => { status: number; content: string },
): Promise<Provider> {
  const calls: Provider['calls'] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      calls.push({
        authorization: request.headers.authorization,
        model: (JSON.parse(body) as { model: string }).model,
      });
      const { status, content } = answer(promptOf(body));
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    calls,
    env: {
      LLM_PROVIDER: 'stub-provider',
      LLM_ENDPOINT: `http://127.0.0.1:${port}/v1/chat/completions`,
      LLM_MODEL: 'gpt://folder123/stub-model',
      LLM_API_KEY: 'test-key-not-secret', // secret-scan: allow — fake key for a local stub provider
      LLM_TIMEOUT_MS: '5000',
    },
  };
}

const NOW = new Date('2026-09-20T21:30:00Z');

/** A fallback reason names the provider, never the folder id or the endpoint. */
function expectNoLeak(file: DemoRecommendationFile): void {
  expect(file.fallbackReason).not.toContain('folder123');
  expect(file.fallbackReason).not.toContain('127.0.0.1');
  expect(file.fallbackReason).not.toContain('test-key');
}
const SLOW = { timeout: 20_000 };

/** The parts of the file the model is not allowed to touch. */
function calculated(file: DemoRecommendationFile) {
  return {
    planId: file.planId,
    requests: file.requests,
    recommendations: file.recommendations,
    applied: file.applied,
    effect: file.effect,
  };
}

describe('E01-llm: режим рекомендации в демо-комплекте', () => {
  test('валидный ответ модели → mode llm, числа и id из расчёта', SLOW, async () => {
    const fake = await provider((prompt) => ({ status: 200, content: honestAnswer(prompt) }));
    const build = await buildDemoFromEnv(fake.env, NOW);
    const file = build.recommendation;
    const reference = buildDemo();

    expect(file.fallbackReason).toBeNull();
    expect(file.mode).toBe('llm');
    // The folder id of a Yandex model name is not published in the set.
    expect(file.llm).toEqual({
      provider: 'stub-provider',
      model: 'gpt://<folder_ID>/stub-model',
      date: '2026-09-21',
    });
    // Same route, same client: four scenarios, the key as a bearer token, the
    // model from the environment.
    expect(fake.calls).toHaveLength(4);
    for (const call of fake.calls) {
      expect(call.authorization).toBe('Bearer test-key-not-secret');
      expect(call.model).toBe('gpt://folder123/stub-model');
    }

    expect(calculated(file)).toEqual(calculated(reference.recommendation));
    expect(build.beforeText).toBe(reference.beforeText);
    expect(build.afterText).toBe(reference.afterText);

    const verified = verifyExplanation({ explanations: file.explanations }, file.recommendations);
    expect(verified.ok ? 'ok' : verified.issues).toBe('ok');
    expect(file.explanations.map((entry) => entry.recommendationId)).toEqual(
      file.recommendations.map((entry) => entry.id),
    );
    // The model chose differently from the template somewhere: the bench place
    // gets its first candidate, not the default one.
    expect(file.explanations).not.toEqual(reference.recommendation.explanations);
    expect(file.note).toContain('модель');

    // Rebuilding from the stored file reproduces it byte for byte: everything
    // but the model's choice is recalculated.
    expect(rebuildFromFile(file).recommendationText).toBe(build.recommendationText);
  });

  test('мусор вместо JSON → fallback с причиной, объяснения из расчёта', SLOW, async () => {
    const fake = await provider(() => ({ status: 200, content: 'Площадь выросла до 500 м²!' }));
    const build = await buildDemoFromEnv(fake.env, NOW);
    const file = build.recommendation;

    expect(file.mode).toBe('fallback');
    expect(file.llm).toBeNull();
    expect(file.fallbackReason).toContain('не прошёл проверку');
    expect(file.fallbackReason).toContain('stub-provider');
    expectNoLeak(file);
    expect(file.explanations).toEqual(buildDemo().recommendation.explanations);
    expect(calculated(file)).toEqual(calculated(buildDemo().recommendation));
  });

  test('выдуманный факт в ответе → fallback, а не показ', SLOW, async () => {
    const fake = await provider((prompt) => {
      const answer = JSON.parse(honestAnswer(prompt)) as {
        explanations: { factIds: string[] }[];
      };
      answer.explanations[0]?.factIds.push('f_invented');
      return { status: 200, content: JSON.stringify(answer) };
    });
    const file = (await buildDemoFromEnv(fake.env, NOW)).recommendation;

    expect(file.mode).toBe('fallback');
    expect(file.fallbackReason).toContain('UNKNOWN_FACT');
  });

  test('ошибка HTTP провайдера → fallback с причиной', SLOW, async () => {
    const fake = await provider(() => ({ status: 500, content: '' }));
    const file = (await buildDemoFromEnv(fake.env, NOW)).recommendation;

    expect(file.mode).toBe('fallback');
    expect(file.fallbackReason).toContain('Модель недоступна');
    expect(file.fallbackReason).toContain('500');
    expectNoLeak(file);
  });

  test('один сценарий из четырёх без модели → весь комплект fallback', SLOW, async () => {
    let call = 0;
    const fake = await provider((prompt) => {
      call += 1;
      return call === 4
        ? { status: 503, content: '' }
        : { status: 200, content: honestAnswer(prompt) };
    });
    const file = (await buildDemoFromEnv(fake.env, NOW)).recommendation;

    expect(fake.calls).toHaveLength(4);
    expect(file.mode).toBe('fallback');
    expect(file.fallbackReason).toContain('503');
    expect(file.explanations).toEqual(buildDemo().recommendation.explanations);
  });

  test('провайдер не настроен → fallback, байт в байт как обычная сборка', SLOW, async () => {
    const withoutKey = await buildDemoFromEnv(
      { LLM_ENDPOINT: 'http://127.0.0.1:9/v1/chat/completions', LLM_MODEL: 'x' },
      NOW,
    );
    expect(withoutKey.recommendation.mode).toBe('fallback');
    expect(withoutKey.recommendation.fallbackReason).toBe(NO_PROVIDER_REASON);
    expect(withoutKey.recommendationText).toBe(buildDemo().recommendationText);
  });

  test('абзац о режиме в effect.md следует фактическому режиму', SLOW, async () => {
    const fallback = renderModeSection(buildDemo().recommendation);
    expect(fallback).toContain('`fallback`');
    // Wrapped like the rest of effect.md; the reason itself is intact.
    expect(fallback.replace(/\s+/g, ' ')).toContain(NO_PROVIDER_REASON);
    for (const line of fallback.split('\n')) expect(line.length).toBeLessThanOrEqual(84);
    expect(fallback).not.toMatch(/не выдан/);

    const fake = await provider((prompt) => ({ status: 200, content: honestAnswer(prompt) }));
    const llm = renderModeSection((await buildDemoFromEnv(fake.env, NOW)).recommendation);
    expect(llm).toContain('`llm`');
    expect(llm).toContain('stub-provider');
    expect(llm).toContain('gpt://<folder_ID>/stub-model');
    expect(llm).toContain('2026-09-21');
    expect(llm).not.toContain('folder123');
    expect(llm).not.toContain('без LLM');

    const markdown = 'до\n<!-- demo-build:mode -->\nстарое\n<!-- /demo-build:mode -->\nпосле\n';
    expect(withModeSection(markdown, 'новое')).toBe(
      'до\n<!-- demo-build:mode -->\nновое\n<!-- /demo-build:mode -->\nпосле\n',
    );
    expect(() => withModeSection('без меток', 'новое')).toThrow();
  });

  test('модель объяснила не все рекомендации → fallback с их id', SLOW, async () => {
    const fake = await provider((prompt) => {
      const answer = JSON.parse(honestAnswer(prompt)) as { explanations: unknown[] };
      // The equipment scenario has two recommendations; the model drops one.
      return {
        status: 200,
        content: JSON.stringify({ explanations: answer.explanations.slice(0, 1) }),
      };
    });
    const file = (await buildDemoFromEnv(fake.env, NOW)).recommendation;

    expect(file.mode).toBe('fallback');
    // Exactly one id is named: the one the model dropped.
    expect(file.fallbackReason).toMatch(/^Модель не объяснила рекомендации adv_rule_[a-z_]+ \(/);
    expectNoLeak(file);
  });

  test('модель выбрала не тот вариант, что применён в after.json → fallback', SLOW, async () => {
    // A valid choice by itself — the route accepts it — but after.json and
    // effect.md stand on the first variant, so the set would contradict itself.
    const fake = await provider((prompt) => ({ status: 200, content: honestAnswer(prompt, 1) }));
    const file = (await buildDemoFromEnv(fake.env, NOW)).recommendation;

    expect(fake.calls).toHaveLength(4);
    expect(file.mode).toBe('fallback');
    expect(file.fallbackReason).toContain('Модель выбрала другой вариант, чем применён в after.json');
    expect(file.fallbackReason).toContain('adv_ot_bench_2 вместо adv_ot_bench_1');
    expectNoLeak(file);
    expect(file.explanations).toEqual(buildDemo().recommendation.explanations);
  });

  describe('сбор объяснений комплекта из ответов маршрута', () => {
    const { recommendations, explanations, applied } = buildDemo().recommendation;
    const response = (list: Explanation[]): AdviceResponse => ({
      revision: 0,
      recommendations,
      explanations: list,
      mode: 'llm',
    });

    test('все пять объяснены и проверены → ok, чужие id отброшены', () => {
      const foreign: Explanation = { ...explanations[0]!, recommendationId: 'adv_other' };
      const result = collectModelExplanations(
        recommendations,
        applied,
        [{ scenario: 'equipment', response: response([...explanations, foreign]) }],
        'stub/m',
      );
      expect(result).toEqual({ ok: true, explanations });
    });

    test('ровно одна необъяснённая рекомендация → отказ с её id', () => {
      const result = collectModelExplanations(
        recommendations,
        applied,
        [{ scenario: 'equipment', response: response(explanations.slice(1)) }],
        'stub/m',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(recommendations[0]!.id);
    });

    test('маршрут пропустил, а расчёт сборщика не подтверждает → отказ', () => {
      // A route whose own calculation diverged could accept a fact the
      // builder's recommendation does not have; the set check refuses it.
      const [first, ...rest] = explanations;
      const foreignFact = { ...first!, factIds: [...first!.factIds, 'f_from_other_calc'] };
      const result = collectModelExplanations(
        recommendations,
        applied,
        [{ scenario: 'equipment', response: response([foreignFact, ...rest]) }],
        'stub/m',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('UNKNOWN_FACT');
        expect(result.reason).toContain('stub/m');
      }
    });

    test('ответ маршрута в режиме fallback → отказ с его причиной', () => {
      const result = collectModelExplanations(
        recommendations,
        applied,
        [
          {
            scenario: 'place',
            response: { ...response(explanations), mode: 'fallback', fallbackReason: 'таймаут' },
          },
        ],
        'stub/m',
      );
      expect(result).toEqual({ ok: false, reason: 'Сценарий «place», stub/m: таймаут' });
    });
  });

  test('имя модели со схемой публикуется без каталога, прочие — как есть', () => {
    expect(publicModelName('gpt://b1gabc/deepseek-v4-flash')).toBe(
      'gpt://<folder_ID>/deepseek-v4-flash',
    );
    expect(publicModelName('ds://b1gxyz/qwen3-235b/latest')).toBe(
      'ds://<folder_ID>/qwen3-235b/latest',
    );
    expect(publicModelName('deepseek-chat')).toBe('deepseek-chat');
  });
});
