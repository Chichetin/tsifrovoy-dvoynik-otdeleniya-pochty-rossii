/**
 * A04 acceptance: что модели показать не дадут.
 *
 * Корпус `src/contracts/fixtures/advice.json` размечен F02: у каждого кода есть
 * принимаемый и отвергаемый случай с ожидаемой причиной отказа. Первый тест
 * прогоняет весь корпус целиком — это и есть общий с A03 корпус из карточки
 * пакета. Остальные тесты добавляют то, чего в корпусе нет: не-JSON, лишнее
 * поле с выдуманным числом и подмена прогноза чужого варианта размещения.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Explanation, Recommendation } from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import { applyCommand } from '../commands';
import { contains, footprint } from '../geometry';
import { layoutZone } from './layout';
import { acceptFactChoice, acceptToolResult, calculateAdvice, createAgentSession, WHY_LEAD } from './index';
import {
  EXPLANATION_ISSUE_CODES,
  WHY_ISSUE_CODES,
  defaultExplanation,
  verifyExplanation,
  verifyWhyText,
  type WhyScope,
} from './explanation';
import { fallbackExplanation, renderExplanation } from './templates';
import type {
  Catalog,
  Equipment,
  ObjectType,
  PlanDocument,
  Point,
} from '../../contracts/model';
import { SCHEMA_VERSION } from '../../contracts/model';

type Corpus = {
  cases: {
    name: string;
    expect: 'accept' | 'reject';
    rejectCode?: string;
    recommendations: Recommendation[];
    explanation: Explanation;
  }[];
};

const corpus = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src', 'contracts', 'fixtures', 'advice.json'),
    'utf8',
  ),
) as Corpus;

/** `candidate-required` из корпуса — это код CANDIDATE_REQUIRED. */
function expectedCode(rejectCode: string): string {
  return rejectCode.replace(/-/g, '_').toUpperCase();
}

function answer(explanation: Explanation): string {
  return JSON.stringify({ explanations: [explanation] });
}

const DESK: ObjectType = {
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
  provenance: 'Допущение команды: условный размер для теста объяснений.',
  attributes: [],
};

const catalog: Catalog = {
  version: 'test-1',
  objectTypes: [DESK],
  zoneTypes: [
    { id: 'zt_client', label: 'Клиентская зона', color: '#E7F5FF', attributes: [] },
  ],
  layerTypes: [],
  rules: [],
};

function plan(objects: Equipment[] = []): PlanDocument {
  return {
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
    objects,
    catalog,
    extensions: {},
  };
}

function object(id: string, position: Point): Equipment {
  return {
    id,
    typeId: 'ot_desk',
    label: id,
    position,
    size_m: [2, 1],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.75,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
  };
}

/** Рекомендация размещения из настоящего расчёта, с двумя и более вариантами. */
function placement(): Recommendation {
  const result = calculateAdvice(plan(), {
    scenario: 'place',
    typeId: 'ot_desk',
    zoneId: null,
    anchor: [5, 4],
  });
  if (!result.ok || result.value[0] === undefined)
    throw new Error('расчёт не дал рекомендации');
  return result.value[0];
}

describe('A04: проверка ответа модели', () => {
  test('корпус F02 проходит целиком: принимаемые приняты, отвергаемые — со своим кодом', () => {
    expect(corpus.cases.length).toBeGreaterThan(0);
    for (const entry of corpus.cases) {
      const result = verifyExplanation(answer(entry.explanation), entry.recommendations);
      if (entry.expect === 'accept') {
        expect({ name: entry.name, ok: result.ok }).toEqual({
          name: entry.name,
          ok: true,
        });
        continue;
      }
      expect({ name: entry.name, ok: result.ok }).toEqual({
        name: entry.name,
        ok: false,
      });
      if (result.ok || entry.rejectCode === undefined) continue;
      expect({
        name: entry.name,
        codes: result.issues.map((issue) => issue.code),
      }).toEqual({
        name: entry.name,
        codes: expect.arrayContaining([expectedCode(entry.rejectCode)]),
      });
    }
  });

  test('не-JSON и посторонний текст уходят в отказ, а не в исключение', () => {
    const advice = [placement()];

    expect(verifyExplanation('Конечно! Вот ответ: место найдено.', advice)).toMatchObject(
      {
        ok: false,
        issues: [{ code: EXPLANATION_ISSUE_CODES.NOT_JSON }],
      },
    );
    expect(verifyExplanation('', advice).ok).toBe(false);
    expect(verifyExplanation(undefined, advice).ok).toBe(false);
  });

  test('JSON в ограждении из ``` разбирается: это не меняет ни одного числа', () => {
    const advice = placement();
    const explanation = defaultExplanation(advice);
    expect(explanation).not.toBeNull();

    const fenced = '```json\n' + answer(explanation as Explanation) + '\n```';

    expect(verifyExplanation(fenced, [advice])).toEqual({
      ok: true,
      value: [explanation],
    });
  });

  test('лишнее поле с выдуманным числом отклоняется целиком', () => {
    const advice = placement();
    const explanation = defaultExplanation(advice) as Explanation;

    const withExtra = JSON.stringify({
      explanations: [{ ...explanation, freeAreaAfter: 61.5 }],
    });

    expect(verifyExplanation(withExtra, [advice])).toMatchObject({
      ok: false,
      issues: [{ code: EXPLANATION_ISSUE_CODES.SHAPE_INVALID }],
    });
  });

  test('прогноз чужого варианта размещения не проходит', () => {
    const advice = placement();
    const first = advice.candidates[0];
    const second = advice.candidates[1];
    expect(second).toBeDefined();
    const alien = second?.facts.find((fact) => fact.phase === 'after');
    expect(alien).toBeDefined();

    const swapped: Explanation = {
      recommendationId: advice.id,
      candidateId: first?.id ?? null,
      reasonCode: 'placement.available',
      factIds: [...(defaultExplanation(advice)?.factIds ?? []), alien?.id ?? ''],
    };

    expect(verifyExplanation(answer(swapped), [advice])).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        {
          code: EXPLANATION_ISSUE_CODES.CANDIDATE_FACT_MISMATCH,
          severity: 'error',
          message: expect.any(String),
          refs: expect.any(Array),
        },
      ]),
    });
  });

  test('ссылка на несуществующий факт не принимается за подтверждение', () => {
    const advice = placement();
    const explanation = defaultExplanation(advice) as Explanation;

    const result = verifyExplanation(
      answer({ ...explanation, factIds: [...explanation.factIds, 'f_свободно_после'] }),
      [advice],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual([
      EXPLANATION_ISSUE_CODES.UNKNOWN_FACT,
    ]);
  });

  test('запасное объяснение берёт факты своего варианта, а не первые по порядку', () => {
    const advice = placement();
    const [first, second] = advice.candidates;
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    // Контракт не требует порядка фактов: кладём прогноз второго варианта
    // первым и проверяем, что объяснение всё равно о первом варианте.
    const reordered: Recommendation = {
      ...advice,
      facts: [
        ...second.facts,
        ...advice.facts.filter((fact) => !second.facts.some((own) => own.id === fact.id)),
      ],
    };

    const explanation = defaultExplanation(reordered);

    expect(explanation?.candidateId).toBe(first.id);
    expect(
      explanation?.factIds.some((id) => second.facts.some((fact) => fact.id === id)),
    ).toBe(false);
    expect(verifyExplanation(answer(explanation as Explanation), [reordered]).ok).toBe(
      true,
    );
  });

  test('рекомендация не из этого расчёта и два объяснения на одну рекомендацию', () => {
    const advice = placement();
    const explanation = defaultExplanation(advice) as Explanation;

    expect(
      verifyExplanation(answer({ ...explanation, recommendationId: 'adv_other' }), [
        advice,
      ]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: EXPLANATION_ISSUE_CODES.UNKNOWN_RECOMMENDATION }],
    });

    const twice = JSON.stringify({ explanations: [explanation, explanation] });
    expect(verifyExplanation(twice, [advice])).toMatchObject({
      ok: false,
      issues: [{ code: EXPLANATION_ISSUE_CODES.DUPLICATE_RECOMMENDATION }],
    });
  });

  test('код, которого расчёт не предлагал, не проходит даже с верными фактами', () => {
    const advice = placement();
    const explanation = defaultExplanation(advice) as Explanation;

    const result = verifyExplanation(
      answer({ ...explanation, reasonCode: 'placement.none' }),
      [advice],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Отказ перечисляет все причины: код не предлагался и вариант размещения
    // этому коду не положен.
    expect(result.issues.map((issue) => issue.code)).toEqual([
      EXPLANATION_ISSUE_CODES.REASON_NOT_ALLOWED,
      EXPLANATION_ISSUE_CODES.CANDIDATE_FORBIDDEN,
    ]);
  });
});

describe('A04: тексты объяснений', () => {
  test('объяснение размещения собирается из фактов расчёта', () => {
    const advice = placement();

    const text = fallbackExplanation(advice);

    expect(text).toContain('Место найдено: Стол');
    expect(text).toContain('Свободная площадь: 80,00 → 78,00 м²');
    expect(text).toContain('Объектов этого типа: 0 → 1');
    expect(text).not.toContain('{');
  });

  test('число в тексте записано так же, как в карточке варианта: 0,575 → 0,58, а не 0,57 (#94)', () => {
    const advice = placement();
    const candidate = advice.candidates[0];
    if (candidate === undefined) throw new Error('нет варианта');
    const moved: Recommendation = {
      ...advice,
      candidates: [{ ...candidate, object: { ...candidate.object, position: [3.835, 0.575] } }],
    };

    const text = fallbackExplanation(moved);

    expect(text).toContain('0,58');
    expect(text).not.toContain('0,57');
  });

  test('сравнение: знак разницы ставит шаблон, а не модель', () => {
    const before = plan();
    const after = plan([object('eq_desk_1', [3, 3])]);
    const result = calculateAdvice(after, { scenario: 'compare', before });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value[0] === undefined) return;

    const text = fallbackExplanation(result.value[0]);

    expect(text).toContain('Свободная площадь: 80,00 → 78,00 м² (−2,00 м²)');
    expect(text).toContain('Изменения объектов: добавлено 1');
  });

  test('недостача: разницу считает шаблон из названных фактов', () => {
    const advice: Recommendation = {
      id: 'adv_rule_bench_min_z_waiting_missing',
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
          value: 3,
          unit: 'count',
          refs: [{ kind: 'zone', id: 'z_waiting' }],
        },
      ],
      ruleIds: ['rule_bench_min'],
      assumptions: [],
      reasonCodes: ['equipment.missing'],
      limitations: [REASON_CODE_SPECS['equipment.missing'].requiredLimitation],
      changes: [],
    };

    expect(fallbackExplanation(advice)).toBe(
      'Не хватает оборудования: 1 при минимуме 3. Разница: 2.',
    );
  });

  test('объяснение без нужного факта не рисуется наполовину', () => {
    const advice = placement();
    const broken: Explanation = {
      recommendationId: advice.id,
      candidateId: advice.candidates[0]?.id ?? null,
      reasonCode: 'placement.available',
      factIds: [advice.facts[0]?.id ?? ''],
    };

    expect(renderExplanation(advice, broken)).toBeNull();
  });

  test('запасное объяснение проходит ту же проверку, что и ответ модели', () => {
    for (const request of [
      { scenario: 'place', typeId: 'ot_desk', zoneId: null } as const,
      { scenario: 'compare', before: plan() } as const,
    ]) {
      const result = calculateAdvice(plan([object('eq_desk_1', [3, 3])]), request);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const advice of result.value) {
        const explanation = defaultExplanation(advice);
        expect(explanation).not.toBeNull();
        expect(verifyExplanation(answer(explanation as Explanation), [advice]).ok).toBe(
          true,
        );
        expect(renderExplanation(advice, explanation as Explanation)).not.toBeNull();
      }
    }
  });
});

describe('#69: ход агента без сети — модель выбирает только предложенные факты', () => {
  const demo = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as PlanDocument;
  const offeredIds = (content: string): string[] =>
    (JSON.parse(content) as { answerFacts: { id: string }[] }).answerFacts.map((fact) => fact.id);

  test('непредложенный факт — одна просьба переписать, затем расчёт без LLM', () => {
    const session = createAgentSession(demo, null, 'Что в плане?', 1);
    expect(offeredIds(acceptToolResult(session, 'plan_overview', '{}').content).length).toBeGreaterThan(0);
    const invented = JSON.stringify({ factIds: ['выдуманный-факт'] });
    expect(acceptFactChoice(session, invented).kind).toBe('repair');
    const second = acceptFactChoice(session, invented);
    expect(second.kind === 'answer' && second.answer.mode).toBe('fallback');
  });

  test('настоящий, но не показанный модели факт не принимается', () => {
    const session = createAgentSession(demo, null, 'Что в плане?', 1);
    const [hidden] = offeredIds(acceptToolResult(session, 'plan_overview', '{}').content);
    // As if the size budget had cut it from the envelope.
    session.offered.delete(hidden!);
    expect(acceptFactChoice(session, JSON.stringify({ factIds: [hidden] })).kind).toBe('repair');
  });

  test('предложенный факт — ответ LLM с текстом, написанным кодом', () => {
    const session = createAgentSession(demo, null, 'Что в плане?', 1);
    const offered = JSON.parse(acceptToolResult(session, 'plan_overview', '{}').content) as { answerFacts: { id: string; text: string }[] };
    const first = offered.answerFacts[0]!;
    const choice = acceptFactChoice(session, JSON.stringify({ factIds: [first.id] }));
    expect(choice.kind === 'answer' && choice.answer.mode).toBe('llm');
    // The visible text is the fact as code rendered it, not the model's JSON.
    expect(choice.kind === 'answer' && choice.answer.text).toContain(first.text);
  });
});

describe('#178: «почему сюда» — свободный текст модели, id и числа проверяет код', () => {
  const scope: WhyScope = {
    ids: new Set(['z_waiting', 'eq_6', 'rule_bench_min']),
    rules: new Set(['rule_bench_min']),
    names: new Set(['Скамья ожидания 1']),
    numbers: [15.27, 16.07, 0.38, 3],
    variants: 3,
  };
  const codes = (text: string): string[] => {
    const result = verifyWhyText(text, scope);
    return result.ok ? [] : result.issues.map((entry) => entry.code);
  };

  test('id плана, число с точностью текста, вариант расчёта и правило команды проходят', () => {
    expect(codes('Вариант 1 лучше: «Скамья ожидания 1» (eq_6) остаётся в z_waiting, свободно 15,3 → 16,07 м², зазор 0,38 м; по правилу rule_bench_min (правило команды, не норматив Почты).')).toEqual([]);
  });

  test('выдуманное число', () => {
    expect(codes('Вариант 1 освободит 12,5 м².')).toEqual([WHY_ISSUE_CODES.UNKNOWN_NUMBER]);
  });

  test('несуществующий id', () => {
    expect(codes('Вариант 1 ставит скамью в z_lobby.')).toEqual([WHY_ISSUE_CODES.UNKNOWN_ID]);
  });

  test('вариант, которого расчёт не давал', () => {
    expect(codes('Вариант 4 лучше варианта 2.')).toEqual([WHY_ISSUE_CODES.UNKNOWN_VARIANT]);
  });

  test('правило справочника названо нормативом', () => {
    expect(codes('По нормативу вариант 1 лучше.')).toEqual([WHY_ISSUE_CODES.RULE_AS_NORM]);
  });

  test('правило без слов «правило команды»', () => {
    expect(codes('Вариант 1 лучше по правилу rule_bench_min.')).toEqual([WHY_ISSUE_CODES.RULE_SOURCE_MISSING]);
  });

  const demo = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as PlanDocument;
  const relocation = (): { session: ReturnType<typeof createAgentSession>; factId: string } => {
    const session = createAgentSession(demo, null, 'Предложить место для eq_1: куда перенести и почему?', 1);
    const offered = JSON.parse(acceptToolResult(session, 'find_place', JSON.stringify({ objectId: 'eq_1' })).content) as { answerFacts: { id: string }[] };
    return { session, factId: offered.answerFacts[0]!.id };
  };

  test('проверенное обоснование открывает ответ LLM, варианты с числами пишет код', () => {
    const { session, factId } = relocation();
    const why = 'Вариант 1 переносит «Терминал электронной очереди» (eq_1) ближе ко входу, а «оставить как есть» держит его в z_waiting.';
    const choice = acceptFactChoice(session, JSON.stringify({ factIds: [factId], why }));
    expect(choice.kind === 'answer' && choice.answer.mode).toBe('llm');
    expect(choice.kind === 'answer' && choice.answer.text.startsWith(`${WHY_LEAD}${why}`)).toBe(true);
    expect(choice.kind === 'answer' && choice.answer.text).toContain('Вариант 1 — ');
  }, 20_000);

  test('выдуманное число в обосновании дважды — расчёт без LLM, числа нет на экране', () => {
    const { session, factId } = relocation();
    const invented = JSON.stringify({ factIds: [factId], why: 'Вариант 1 освободит 99,9 м².' });
    expect(acceptFactChoice(session, invented).kind).toBe('repair');
    const second = acceptFactChoice(session, invented);
    expect(second.kind === 'answer' && second.answer.mode).toBe('fallback');
    expect(second.kind === 'answer' && second.answer.fallbackReason).toContain('Обоснование модели не прошло проверку');
    expect(second.kind === 'answer' && second.answer.text).not.toContain('99,9');
    expect(second.kind === 'answer' && second.answer.text).toContain('Вариант 1 — ');
  }, 20_000);
});

describe('#126: правки модели проверяет код', () => {
  const demo = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as PlanDocument;

  test('несуществующий id отброшен с причиной, верная правка осталась', () => {
    const session = createAgentSession(demo, null, 'Подвинь скамью', 1);
    const edits = [{ op: 'delete', id: 'eq_nope' }, { op: 'move', id: 'eq_9', dx_m: 0.5, dy_m: 0 }];
    acceptToolResult(session, 'propose_edits', JSON.stringify({ edits }));
    const [proposal] = session.state.proposals;
    expect(proposal?.rejected.map((entry) => entry.reason)).toEqual(['Объекта «eq_nope» нет в плане.']);
    expect(proposal?.commands.map((command) => command.type === 'object.put' && command.object.id)).toEqual(['eq_9']);
  });
});

describe('#122: раскладку зоны считает код', () => {
  const demo = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as PlanDocument;

  test('каждый вариант применяется одним batch без новых ошибок, «было» у вариантов общее', () => {
    const session = createAgentSession(demo, null, 'Разложи зону ожидания', 1);
    acceptToolResult(session, 'layout_zone', JSON.stringify({ zoneId: 'z_waiting' }));
    const variants = session.state.proposals;
    expect(variants.length).toBeGreaterThan(0);
    const passageBefore = new Set(variants.map((variant) => variant.facts.find((fact) => fact.metric === 'layout.passage' && fact.phase === 'before')?.value));
    expect(passageBefore.size).toBe(1);
    const zone = demo.zones.find((entry) => entry.id === 'z_waiting')!.polygon;
    for (const variant of variants) {
      expect(applyCommand(demo, { type: 'batch', commands: variant.commands }).ok).toBe(true);
      expect(variant.findings.errors.after).toBeLessThanOrEqual(variant.findings.errors.before);
      for (const command of variant.commands) expect(command.type === 'object.put' && contains(zone, footprint(command.object))).toBe(true);
    }
    // Seeded search: the same plan gives the same variants.
    expect(layoutZone(demo, 'z_waiting', null)).toEqual(layoutZone(demo, 'z_waiting', null));
    // The search runs three times here: 1.4 s alone, over the default 5 s when the whole suite runs in parallel.
  }, 20_000);
});
