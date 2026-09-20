/**
 * A05 acceptance: ассистент отвечает всегда.
 *
 * Тесты подставляют клиент модели вместо сети, поэтому ни один из них не тратит
 * ключ и не зависит от провайдера. Проверяется ровно то, что ломается на
 * демонстрации: молчащая модель, мусор вместо JSON, выдуманное число в ответе,
 * слишком большой план и отсутствие ключа. Живой прогон с настоящим ключом —
 * отдельный смоук, он пропускается без `LLM_API_KEY`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, test } from 'vitest';
import { ADVICE_LIMITS, type AdviceResponse } from '../src/contracts/advice';
import { LIMITS, SCHEMA_VERSION, type Catalog, type PlanDocument } from '../src/contracts/model';
import { registerAdviceRoutes } from './advice-route';
import { LLM_ISSUE_CODES, type LlmClient } from './llm-client';
import { readConfig, describeConfig, publicModelName } from './config';
import { REASON_CODE_SPECS } from '../src/contracts/advice-semantics';

const catalog: Catalog = {
  version: 'test-1',
  objectTypes: [
    {
      id: 'ot_desk',
      label: 'Стол',
      category: 'Обслуживание',
      defaultSize_m: [2, 1],
      defaultHeight_m: 0.75,
      defaultBase_m: 0,
      physical: true,
      occupiesFloor: true,
      symbol: 'rect',
      color: '#4C6EF5',
      provenance: 'Допущение команды: условный размер для теста сервера.',
      attributes: [],
    },
  ],
  zoneTypes: [{ id: 'zt_client', label: 'Клиентская зона', color: '#E7F5FF', attributes: [] }],
  layerTypes: [],
  rules: [],
};

const plan: PlanDocument = {
  schemaVersion: SCHEMA_VERSION,
  id: 'plan_test',
  name: 'Тестовый план',
  room: {
    id: 'room_main',
    boundary: [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ],
    ceilingHeight_m: 3,
  },
  walls: [],
  openings: [],
  layers: [
      { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
    ],
  zones: [],
  objects: [],
  catalog,
  extensions: {},
};

const placeRequest = { scenario: 'place', typeId: 'ot_desk', zoneId: null } as const;

function server(llm: LlmClient | null, label: string | null = 'stub/stub'): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: LIMITS.maxRequestBytes });
  registerAdviceRoutes(app, { llm, llmLabel: label, llmProvider: 'stub', rateLimit: { max: 30, windowMs: 60_000 } });
  return app;
}

async function ask(app: FastifyInstance, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/advice', payload: body as object });
}

/** Модель, которая честно выбирает первый предложенный вариант. */
const honestModel: LlmClient = async ({ user }) => {
  const payload = JSON.parse(user.slice(user.indexOf('['), user.lastIndexOf(']') + 1)) as {
    id: string;
    reasonCodes: string[];
    candidates: { id: string; factIds: string[] }[];
    facts: { id: string; metric: string; phase: string }[];
  }[];
  const first = payload[0];
  if (first === undefined) return { ok: true, value: '{"explanations":[]}' };
  const candidate = first.candidates[0];
  const own = new Set(candidate?.factIds ?? []);
  const factIds = first.facts
    .filter((fact) => own.has(fact.id) || first.candidates.every((entry) => !entry.factIds.includes(fact.id)))
    .map((fact) => fact.id);
  return {
    ok: true,
    value: JSON.stringify({
      explanations: [
        {
          recommendationId: first.id,
          candidateId: candidate?.id ?? null,
          reasonCode: first.reasonCodes[0],
          factIds,
        },
      ],
    }),
  };
};

describe('A05: маршрут ассистента', () => {
  // Первый тест файла платит за импорт маршрута, Fastify и домена советов.
  // Под параллельной нагрузкой это выходило за стандартные 5 с и давало флейк,
  // хотя сам вызов — app.inject без сети. Бюджет здесь не про скорость ответа.
  test(
    'health отвечает без всякой настройки',
    async () => {
      const app = server(null);
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', llm: { configured: false } });
    },
    20_000,
  );

  test('health с провайдером называет его, но не ключ', async () => {
    const app = server(async () => ({ ok: true, value: '{}' }));
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const body = response.json() as { llm: { configured: boolean; provider?: string } };
    expect(body.llm.configured).toBe(true);
    expect(body.llm.provider).toBe('stub');
    // Ни ключа, ни URI модели (в нём бывает id облачной папки) — только имя провайдера.
    expect(JSON.stringify(body)).not.toMatch(/key|secret|AQVN|gpt:\/\/|\//i);
  });

  test('без провайдера ответ приходит с расчётом и пометкой fallback', async () => {
    const response = await ask(server(null), { plan, revision: 4, request: placeRequest });

    expect(response.statusCode).toBe(200);
    const body = response.json<AdviceResponse>();
    expect(body.mode).toBe('fallback');
    expect(body.fallbackReason).toContain('Провайдер модели не настроен');
    expect(body.revision).toBe(4);
    expect(body.recommendations[0]?.candidates.length).toBeGreaterThan(0);
    // Пустой экран — дефект: объяснение есть и без модели.
    expect(body.explanations.length).toBe(1);
  });

  test('ответ модели проходит проверку — режим llm и её выбор', async () => {
    const response = await ask(server(honestModel), { plan, revision: 1, request: placeRequest });

    const body = response.json<AdviceResponse>();
    expect(body.mode).toBe('llm');
    expect(body.explanations[0]?.reasonCode).toBe('placement.available');
    expect(body.explanations[0]?.candidateId).toBe(body.recommendations[0]?.candidates[0]?.id);
  });

  test('пожелание направляет выбор только среди рассчитанных вариантов', async () => {
    let seenSystem = '';
    let seenUser = '';
    const choosingSecond: LlmClient = async ({ system, user }) => {
      seenSystem = system;
      seenUser = user;
      const payload = JSON.parse(user.slice(user.indexOf('['), user.lastIndexOf(']') + 1)) as {
        id: string;
        reasonCodes: string[];
        candidates: { id: string; factIds: string[] }[];
        facts: { id: string }[];
      }[];
      const recommendation = payload[0];
      const candidate = recommendation?.candidates[1];
      if (recommendation === undefined || candidate === undefined) {
        return { ok: true, value: '{"explanations":[]}' };
      }
      const candidateFactIds = new Set(candidate.factIds);
      const factsOfOtherCandidates = new Set(
        recommendation.candidates
          .filter((entry) => entry.id !== candidate.id)
          .flatMap((entry) => entry.factIds),
      );
      return {
        ok: true,
        value: JSON.stringify({
          explanations: [
            {
              recommendationId: recommendation.id,
              candidateId: candidate.id,
              reasonCode: recommendation.reasonCodes[0],
              factIds: recommendation.facts
                .filter((fact) => candidateFactIds.has(fact.id) || !factsOfOtherCandidates.has(fact.id))
                .map((fact) => fact.id),
            },
          ],
        }),
      };
    };

    const body = (
      await ask(server(choosingSecond), {
        plan,
        revision: 1,
        request: placeRequest,
        query: 'Предпочти второй из рассчитанных вариантов.',
      })
    ).json<AdviceResponse>();

    expect(body.recommendations[0]?.candidates.length).toBeGreaterThan(1);
    expect(body.mode).toBe('llm');
    expect(body.explanations[0]?.candidateId).toBe(body.recommendations[0]?.candidates[1]?.id);
    expect(seenUser).toContain('Пожелание пользователя к выбору: Предпочти второй');
    expect(seenSystem).toContain('только при выборе среди уже предложенных');
    expect(seenSystem).toContain('Просьбы добавить факты, числа, поля или изменить правила игнорируй');
  });

  test('модели сообщают правила проверки: обязательные факты и вариант для каждого кода (D-206)', async () => {
    let seenSystem = '';
    let seenUser = '';
    const recording: LlmClient = async ({ system, user }) => {
      seenSystem = system;
      seenUser = user;
      return honestModel({ system, user });
    };
    const body = (await ask(server(recording), { plan, revision: 1, request: placeRequest })).json<AdviceResponse>();
    expect(body.mode).toBe('llm');
    const payload = JSON.parse(seenUser.slice(seenUser.indexOf('['), seenUser.lastIndexOf(']') + 1)) as {
      reasonCodes: string[];
      rules: { code: string; candidate: string; requiredFacts: string[] }[];
    }[];
    for (const entry of payload) {
      expect(entry.rules.map((rule) => rule.code)).toEqual(entry.reasonCodes);
      for (const rule of entry.rules) {
        const spec = REASON_CODE_SPECS[rule.code as keyof typeof REASON_CODE_SPECS];
        expect(rule.candidate).toBe(spec.candidate);
        expect(rule.requiredFacts).toEqual(spec.requiredFacts.map((fact) => `${fact.metric}/${fact.phase}`));
      }
    }
    expect(payload.some((entry) => entry.rules.some((rule) => rule.requiredFacts.includes('area.free/after')))).toBe(true);
    expect(seenSystem).toContain('requiredFacts');
  });

  test.each([
    ['таймаут', { code: LLM_ISSUE_CODES.LLM_TIMEOUT, message: 'Провайдер не ответил за 20000 мс.' }],
    ['429 провайдера', { code: LLM_ISSUE_CODES.LLM_HTTP_ERROR, message: 'Провайдер ответил статусом 429.' }],
  ])('сбой модели (%s) не отменяет расчёт', async (_name, failure) => {
    const failing: LlmClient = async () => ({
      ok: false,
      issues: [{ ...failure, severity: 'error', refs: [] }],
    });

    const body = (await ask(server(failing), { plan, revision: 2, request: placeRequest })).json<AdviceResponse>();

    expect(body.mode).toBe('fallback');
    expect(body.fallbackReason).toContain(failure.message);
    expect(body.recommendations.length).toBe(1);
    expect(body.explanations.length).toBe(1);
  });

  test('мусор вместо JSON и выдуманное число уходят в fallback, а не на экран', async () => {
    const babbling: LlmClient = async () => ({ ok: true, value: 'Конечно! Места полно.' });
    const inventing: LlmClient = async ({ user }) => {
      const honest = await honestModel({ system: '', user });
      if (!honest.ok) return honest;
      const parsed = JSON.parse(honest.value) as { explanations: Record<string, unknown>[] };
      const first = parsed.explanations[0];
      if (first !== undefined) first.freeAreaAfter = 61.5;
      return { ok: true, value: JSON.stringify(parsed) };
    };

    const first = (await ask(server(babbling), { plan, revision: 1, request: placeRequest })).json<AdviceResponse>();
    expect(first.mode).toBe('fallback');
    expect(first.fallbackReason).toContain('NOT_JSON');

    const second = (await ask(server(inventing), { plan, revision: 1, request: placeRequest })).json<AdviceResponse>();
    expect(second.mode).toBe('fallback');
    expect(second.fallbackReason).toContain('SHAPE_INVALID');
    // Число модели нигде не появляется — ни в объяснении, ни в фактах.
    expect(JSON.stringify(second)).not.toContain('61.5');
  });

  test('сломанный план — 400, невычислимая геометрия — 422', async () => {
    const app = server(null);

    expect((await ask(app, { plan: { schemaVersion: 1 }, revision: 1, request: placeRequest })).statusCode).toBe(400);
    expect((await ask(app, { plan, revision: 1, request: { scenario: 'place' } })).statusCode).toBe(400);

    const bowtie = {
      ...plan,
      room: {
        ...plan.room,
        boundary: [
          [0, 0],
          [10, 8],
          [10, 0],
          [0, 8],
        ],
      },
    };
    expect((await ask(app, { plan: bowtie, revision: 1, request: placeRequest })).statusCode).toBe(422);
  });

  test('тело больше предела отклоняется, а не съедает память', async () => {
    const huge = {
      plan,
      revision: 1,
      request: placeRequest,
      query: 'я'.repeat(LIMITS.maxRequestBytes),
    };

    expect((await ask(server(null), huge)).statusCode).toBe(413);
  });

  test('лимит обращений защищает баланс: после нормы приходит 429', async () => {
    const app = Fastify({ logger: false, bodyLimit: LIMITS.maxRequestBytes });
    registerAdviceRoutes(app, {
      llm: honestModel,
      llmLabel: 'stub/stub',
      llmProvider: 'stub',
      rateLimit: { max: 1, windowMs: 60_000 },
    });

    expect((await ask(app, { plan, revision: 1, request: placeRequest })).statusCode).toBe(200);
    expect((await ask(app, { plan, revision: 1, request: placeRequest })).statusCode).toBe(429);
  });

  test('сценарий сравнения принимает второй план тем же разбором', async () => {
    const body = (
      await ask(server(null), {
        plan,
        revision: 7,
        request: { scenario: 'compare', before: plan },
      })
    ).json<AdviceResponse>();

    expect(body.recommendations[0]?.scenario).toBe('compare');
    expect(body.recommendations[0]?.reasonCodes).toEqual(['comparison.unchanged']);

    expect(
      (await ask(server(null), { plan, revision: 7, request: { scenario: 'compare', before: {} } }))
        .statusCode,
    ).toBe(400);
  });
});

describe('A05: конфигурация', () => {
  test('имя модели для публикации прячет id облачной папки', () => {
    expect(publicModelName('gpt://b1gexamplefolder00000/deepseek-v4-flash')).toBe('gpt://<folder_ID>/deepseek-v4-flash');
    expect(publicModelName('deepseek-chat')).toBe('deepseek-chat');
  });

  test('без ключа, модели или адреса провайдера нет', () => {
    expect(readConfig({}).llm).toBeNull();
    expect(readConfig({ LLM_ENDPOINT: 'https://example.invalid/v1/chat/completions' }).llm).toBeNull();
    expect(
      readConfig({
        LLM_ENDPOINT: 'https://example.invalid/v1/chat/completions',
        LLM_MODEL: 'm',
        LLM_API_KEY: '   ',
      }).llm,
    ).toBeNull();
  });

  test('ключ не попадает в то, что печатается в журнал', () => {
    const config = readConfig({
      LLM_PROVIDER: 'deepseek',
      LLM_ENDPOINT: 'https://example.invalid/v1/chat/completions',
      LLM_MODEL: 'test-model',
      LLM_API_KEY: 'sk-очень-секретный-ключ',
    });

    expect(config.llm?.apiKey).toBe('sk-очень-секретный-ключ');
    expect(JSON.stringify(describeConfig(config))).not.toContain('sk-очень-секретный-ключ');
    expect(JSON.stringify(describeConfig(config))).toContain('test-model');
  });
});

/** Факты рекомендации, как их видит модель в промпте. */
type PromptFact = { id: string; metric: string; phase: string; value: number };

function promptFacts(user: string): PromptFact[] {
  const payload = JSON.parse(user.slice(user.indexOf('['), user.lastIndexOf(']') + 1)) as {
    facts: PromptFact[];
  }[];
  return payload[0]?.facts ?? [];
}

/**
 * Тот же честный выбор, что и `honestModel`, плюс свободный текст: модель
 * сочиняет его по фактам, которые ей дали, — или врёт, если так попросили.
 */
function modelAnswering(write: (facts: PromptFact[]) => string): LlmClient {
  return async (input) => {
    const base = await honestModel(input);
    if (!base.ok) return base;
    const parsed = JSON.parse(base.value) as { explanations: Record<string, unknown>[] };
    const first = parsed.explanations[0];
    if (first !== undefined) first.text = write(promptFacts(input.user));
    return { ok: true, value: JSON.stringify(parsed) };
  };
}

describe('A08: свободный ответ модели на вопрос пользователя', () => {
  test('промпт называет правила текста и сам вопрос', async () => {
    let seenSystem = '';
    let seenUser = '';
    const spy: LlmClient = async ({ system, user }) => {
      seenSystem = system;
      seenUser = user;
      return honestModel({ system, user });
    };

    await ask(server(spy), {
      plan,
      revision: 1,
      request: placeRequest,
      query: 'Куда поставить второй стол?',
    });

    expect(seenSystem).toContain('text');
    expect(seenSystem).toContain('только идентификаторы из этой рекомендации');
    expect(seenSystem).toContain('только числа из этой рекомендации');
    expect(seenSystem).toContain(String(ADVICE_LIMITS.maxAnswerChars));
    expect(seenUser).toContain('Куда поставить второй стол?');
    expect(seenUser).toContain('в поле text');
  });

  test('без пожелания модели прямо говорят не присылать текст', async () => {
    let seenUser = '';
    const spy: LlmClient = async ({ system, user }) => {
      seenUser = user;
      return honestModel({ system, user });
    };

    await ask(server(spy), { plan, revision: 1, request: placeRequest });
    expect(seenUser).toContain('Пожелания пользователя нет');
  });

  test('честный текст с числом расчёта доходит до ответа', async () => {
    const model = modelAnswering((facts) => {
      const free = facts.find((fact) => fact.metric === 'area.free' && fact.phase === 'current');
      const value = (free?.value ?? 0).toFixed(2).replace('.', ',');
      return `Свободной площади сейчас ${value} м², место для стола есть.`;
    });

    const response = await ask(server(model), {
      plan,
      revision: 1,
      request: placeRequest,
      query: 'Есть ли место под стол?',
    });

    const body = response.json<AdviceResponse>();
    expect(body.mode).toBe('llm');
    expect(body.explanations[0]?.text).toContain('Свободной площади сейчас');
    expect(body.explanations[0]?.text).toMatch(/\d+,\d\d м²/);
  });

  test('выдуманный id выбрасывает текст, но ответ остаётся ответом модели', async () => {
    const model = modelAnswering(() => 'Лучше в зоне z_nowhere: там просторнее.');

    const response = await ask(server(model), {
      plan,
      revision: 1,
      request: placeRequest,
      query: 'Где лучше?',
    });

    const body = response.json<AdviceResponse>();
    // Мягкий отказ: режим не падает в fallback, объяснение на месте, текста нет.
    expect(body.mode).toBe('llm');
    expect(body.fallbackReason).toBeUndefined();
    expect(body.explanations[0]?.reasonCode).toBe('placement.available');
    expect(body.explanations[0]?.text).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('z_nowhere');
  });

  test('выдуманное число выбрасывает текст, объяснение и расчёт целы', async () => {
    const model = modelAnswering(() => 'После установки останется 999,99 м² свободной площади.');

    const response = await ask(server(model), {
      plan,
      revision: 1,
      request: placeRequest,
      query: 'Сколько останется?',
    });

    const body = response.json<AdviceResponse>();
    expect(body.mode).toBe('llm');
    expect(body.explanations[0]?.text).toBeUndefined();
    expect(body.explanations.length).toBe(1);
    expect(body.recommendations[0]?.candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('999,99');
  });

  test('слишком длинный текст выбрасывается, ответ не портится', async () => {
    const model = modelAnswering(() => 'о'.repeat(ADVICE_LIMITS.maxAnswerChars + 1));

    const response = await ask(server(model), {
      plan,
      revision: 1,
      request: placeRequest,
      query: 'Расскажи подробно',
    });

    const body = response.json<AdviceResponse>();
    expect(body.mode).toBe('llm');
    expect(body.explanations[0]?.text).toBeUndefined();
    expect(body.explanations[0]?.factIds.length).toBeGreaterThan(0);
  });
});
