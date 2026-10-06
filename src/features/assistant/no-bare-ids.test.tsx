// @vitest-environment jsdom
/**
 * #10 sentinel: the texts a Почта России employee reads never carry a bare
 * plan id — a zone, an object, an object type, a zone type or a layer
 * (`z_…`/`eq_…`/`ot_…`/`zt_…`/`l_…`). Instead, a name is shown, and the id
 * lives in `title`/`data-ref-id`, one click away, or — for a structured
 * recommendation's assumptions — behind «Допущения и правила».
 *
 * This runs on both demo plans, so a future regression in either fails a
 * test instead of shipping. It checks the surfaces that show text without
 * asking the reader to expand anything first: the chat answer, a structured
 * recommendation's sentence/zone/changes/refs/limitations.
 *
 * #252: with «Отладка» off the whole panel — questions, chips, steps, edits,
 * folded parts included — has no id; with «Отладка» on the ids are there.
 */
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { AdviceResponse } from '../../contracts/advice';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { answerWithoutModel, calculateAdvice, defaultExplanation } from '../../domain/advice';
import { planIndex } from '../../domain/plan-index';
import { AgentChat } from './AgentChat';
import { AssistantPanel } from './AssistantPanel';
import { setDebugMode } from './debug-mode';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(`${path} не разобрался`);
  return parsed.value;
}

const before = load('demo/before.json');
const after = load('demo/after.json');

/** The five prefixes the issue asks to hunt for, as a plan id — not a longer word that merely contains one. */
const BARE_ID_PATTERN = /\b(?:z|eq|ot|zt|l)_[a-z0-9_]*\b/i;

afterEach(() => {
  cleanup();
  setDebugMode(false);
});

/** Every question the free chat's three scenarios and #32 answer without a model. */
const QUESTIONS = [
  'Где поставить ещё одно кассовое окно ближе к входу?',
  'Чего не хватает или что лишнее по оборудованию?',
  'Как мои изменения повлияли на свободную площадь?',
  'Куда поставить информационное табло?',
  'куда поставить стеллаж для посылок?',
  'Расскажи про клиентский зал',
  'Какие ошибки в плане?',
] as const;

/** The rendered chat answer, exactly as AgentChat shows it (ids already turned into name buttons). */
function chatAnswerText(plan: PlanDocument, question: string, planBefore: PlanDocument | null): string {
  const answer = answerWithoutModel(plan, planBefore, question, 0, 'без LLM');
  const { container } = render(
    <AgentChat
      plan={plan}
      revision={0}
      names={planIndex(plan)}
      exchanges={[{ id: 'q', question, revision: 0, steps: answer.steps, answer, error: null }]}
      actionStatus={null}
      onAsk={() => undefined}
      onAction={() => undefined}
      onClear={() => undefined}
    />,
  );
  return container.querySelector('.agent__text')?.textContent ?? '';
}

/** «Место найдено» / «Комплектование» / «Эффект изменений»: a structured recommendation's non-gated text. */
function scenarioTexts(plan: PlanDocument, response: AdviceResponse): string[] {
  const { container } = render(
    <AssistantPanel
      document={plan}
      revision={0}
      response={response}
      state={{ status: 'done' }}
      onPreview={() => undefined}
      onFocus={() => undefined}
      onAsk={() => undefined}
    />,
  );
  // `.advice__more` (assumptions) is deliberately behind «Допущения и правила»
  // and is allowed to keep ids there (D-321) — everything else is not gated.
  return [...container.querySelectorAll('.advice__sentence, .advice__zone, .advice__changes, .advice__refs, .advice__limitations')]
    .map((node) => node.textContent ?? '');
}

function placeResponse(plan: PlanDocument, typeId: string, zoneId: string | null): AdviceResponse {
  const calculated = calculateAdvice(plan, { scenario: 'place', typeId, zoneId });
  const recommendations = calculated.ok ? calculated.value : [];
  return {
    revision: 0,
    recommendations,
    explanations: recommendations.map((entry) => defaultExplanation(entry)).filter((entry) => entry !== null),
    mode: 'fallback',
    fallbackReason: 'проверка',
  };
}

function equipmentResponse(plan: PlanDocument): AdviceResponse {
  const calculated = calculateAdvice(plan, { scenario: 'equipment', zoneId: null });
  const recommendations = calculated.ok ? calculated.value : [];
  return {
    revision: 0,
    recommendations,
    explanations: recommendations.map((entry) => defaultExplanation(entry)).filter((entry) => entry !== null),
    mode: 'fallback',
    fallbackReason: 'проверка',
  };
}

function compareResponse(planBefore: PlanDocument, planAfter: PlanDocument): AdviceResponse {
  const calculated = calculateAdvice(planAfter, { scenario: 'compare', before: planBefore });
  const recommendations = calculated.ok ? calculated.value : [];
  return {
    revision: 0,
    recommendations,
    explanations: recommendations.map((entry) => defaultExplanation(entry)).filter((entry) => entry !== null),
    mode: 'fallback',
    fallbackReason: 'проверка',
  };
}

describe.each([
  ['before.json', before, null as PlanDocument | null],
  ['after.json', after, before],
])('#10: сотрудник не видит голых id — demo/%s', (_name, plan, planBefore) => {
  test.each(QUESTIONS)('ответ ассистента без LLM: «%s»', (question) => {
    const text = chatAnswerText(plan, question, planBefore);
    expect(text).not.toMatch(BARE_ID_PATTERN);
  });

  test('сценарий «место для рабочего места»', () => {
    for (const text of scenarioTexts(plan, placeResponse(plan, 'ot_workplace', null))) {
      expect(text).not.toMatch(BARE_ID_PATTERN);
    }
  });

  test('сценарий «комплектование»', () => {
    for (const text of scenarioTexts(plan, equipmentResponse(plan))) {
      expect(text).not.toMatch(BARE_ID_PATTERN);
    }
  });
});

test('#10: сценарий «эффект изменений» (сравнение before → after)', () => {
  for (const text of scenarioTexts(after, compareResponse(before, after))) {
    expect(text).not.toMatch(BARE_ID_PATTERN);
  }
});

/** #252: the whole chat as rendered — question, chips about the selection, steps, answer, edits, folded parts. */
function wholeChatText(plan: PlanDocument, question: string, planBefore: PlanDocument | null): string {
  const answer = answerWithoutModel(plan, planBefore, question, 0, 'без LLM');
  const object = plan.objects[0]!;
  const { container } = render(
    <AgentChat
      plan={plan}
      revision={0}
      names={planIndex(plan)}
      exchanges={[{ id: 'q', question, revision: 0, steps: answer.steps, answer, error: null }]}
      actionStatus={null}
      onAsk={() => undefined}
      onAction={() => undefined}
      onClear={() => undefined}
      selection={{ kind: 'object', id: object.id }}
    />,
  );
  return container.textContent ?? '';
}

/** #252: the whole card of a structured recommendation, folded parts included. */
function wholePanelText(plan: PlanDocument, response: AdviceResponse): string {
  const { container } = render(
    <AssistantPanel
      document={plan}
      revision={0}
      response={response}
      state={{ status: 'done' }}
      onPreview={() => undefined}
      onFocus={() => undefined}
      onAsk={() => undefined}
    />,
  );
  return container.querySelector('.advice')?.parentElement?.textContent ?? '';
}

/** #252: every plan-shaped id, a rule and an opening included. */
const ANY_ID_PATTERN = /\b(?:z|eq|ot|zt|l|op|rule)_[a-z0-9_]*\b/i;

describe('#252: id зон и объектов — только в «Отладке»', () => {
  const object = before.objects[0]!;
  const questions = [...QUESTIONS, `Предложить место для ${object.id}: куда перенести и почему?`];

  test.each(questions)('чат целиком без «Отладки»: «%s»', (question) => {
    const text = wholeChatText(before, question, null);
    // The answer is there: an empty panel would pass the check below for nothing.
    expect(document.querySelector('.agent__text')?.textContent ?? '').not.toBe('');
    expect(text).not.toMatch(ANY_ID_PATTERN);
  });

  test('карточки сценариев целиком без «Отладки»', () => {
    const responses = [placeResponse(before, 'ot_workplace', null), equipmentResponse(before), compareResponse(before, after)];
    for (const [index, response] of responses.entries()) {
      expect(response.recommendations.length).toBeGreaterThan(0);
      const text = wholePanelText(index === 2 ? after : before, response);
      expect(text).not.toBe('');
      expect(text).not.toMatch(ANY_ID_PATTERN);
      cleanup();
    }
  });

  test('с «Отладкой» id видны в чате и в карточке', () => {
    setDebugMode(true);
    expect(wholeChatText(before, `Предложить место для ${object.id}: куда перенести и почему?`, null)).toContain(object.id);
    cleanup();
    expect(wholePanelText(before, placeResponse(before, 'ot_workplace', null))).toMatch(BARE_ID_PATTERN);
  });
});
