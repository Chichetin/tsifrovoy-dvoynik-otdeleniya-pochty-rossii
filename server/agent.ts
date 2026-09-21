/**
 * D-255: the agent loop. The model reads the plan through tools, attaches
 * interface actions, and writes the answer; code runs every tool and checks
 * every id and number of the final text against what the tools returned.
 *
 * A failed provider, a loop that does not converge, or a text that fails the
 * check twice ends in the same place: the calculation's own answer, marked
 * «без LLM». The loop never throws and never edits the plan.
 */

import type { AgentAnswer, AgentStep, AgentTurn } from '../src/contracts/advice-chat';
import { AGENT_LIMITS } from '../src/contracts/advice-chat';
import type { PlanDocument } from '../src/contracts/model';
import {
  AGENT_TOOL_SPECS,
  agentEvidence,
  answerWithoutModel,
  checkAgentText,
  composeFallbackText,
  createAgentToolState,
  describeProblems,
  finishAgentAnswer,
  runAgentTool,
} from '../src/domain/advice';
import type { LlmChat, LlmMessage } from './llm-client';

export type AgentRun = {
  chat: LlmChat;
  plan: PlanDocument;
  before: PlanDocument | null;
  query: string;
  history: AgentTurn[];
  revision: number;
  onStep: (step: AgentStep) => void;
  /** Wall-clock budget for the whole exchange; the provider timeout bounds each call. */
  deadlineMs: number;
  now?: () => number;
};

/** A tool output larger than this is cut: the model needs the gist, not megabytes. */
const MAX_TOOL_OUTPUT_CHARS = 8_000;

export function agentSystemPrompt(plan: PlanDocument, hasBefore: boolean): string {
  return [
    'Ты — ИИ-ассистент цифрового двойника отделения Почты России. Помогаешь руководителю отделения, проектировщику перепланировки и специалисту по инвентаризации разобраться в текущем плане и решить, что изменить.',
    `Открыт план «${plan.name}».${hasBefore ? ' Есть исходный вариант для сравнения (compare_with_original).' : ''}`,
    'Правила:',
    '1. Факты о плане получай только инструментами. Числа (площади, количества, расстояния) бери только из их результатов; сам не считай, можно лишь округлить до целых или десятых.',
    '2. Называя зону или объект, добавляй его id в скобках: «Клиентский зал (z_client)». Не пиши id рекомендаций, вариантов и фактов.',
    '3. План ты не меняешь. Нашёл место через find_place — предложи лучший вариант инструментом suggest_candidate: он появится на плане полупрозрачно, человек сам нажмёт «Применить».',
    '4. Подсвечивай то, о чём говоришь, инструментом show_on_plan. Если помогает слой (камеры, тепло, сотрудники, очередь) или панель — suggest_layer / open_panel.',
    '5. Правила комплектования — допущения команды, не нормативы Почты России; если вывод на них опирается, так и скажи. Атрибуты зон (посетители, нагрузка) синтетические, не выдавай их за измерения.',
    '6. Отвечай по-русски, деловым языком, 2–6 предложений, без таблиц и заголовков. Сначала вывод, потом основание.',
    '7. Вопрос не о плане отделения — коротко скажи, чем можешь помочь.',
  ].join('\n');
}

export const PLAN_CHANGED_NOTE =
  'После предыдущих ответов план изменили — например, применили предложенный вариант. Прежние числа устарели: бери свежие данные инструментами и считай, что изменения уже в плане.';

function changedSince(history: readonly AgentTurn[], revision: number): boolean {
  return history.some((turn) => turn.revision !== revision);
}

function historyMessages(history: readonly AgentTurn[]): LlmMessage[] {
  return history.slice(-AGENT_LIMITS.maxTurns).map((turn) => ({ role: turn.role, content: turn.text }));
}

export async function runAgent(run: AgentRun): Promise<AgentAnswer> {
  const now = run.now ?? Date.now;
  const deadline = now() + run.deadlineMs;
  const state = createAgentToolState(run.plan, run.before);
  const steps: AgentStep[] = [];
  const records: { name: string; output: unknown }[] = [];
  const messages: LlmMessage[] = [
    { role: 'system', content: agentSystemPrompt(run.plan, run.before !== null) },
    ...historyMessages(run.history),
    { role: 'user', content: changedSince(run.history, run.revision) ? `${run.query}\n\n(${PLAN_CHANGED_NOTE})` : run.query },
  ];
  // Numbers the person already saw in verified answers about this very
  // revision may be repeated; answers about an older plan may not.
  const citedContext = [
    run.query,
    ...run.history.filter((turn) => turn.revision === run.revision).map((turn) => turn.text),
  ].join('\n');
  let repaired = false;
  // A thinking model often states its conclusion next to the tool calls and
  // only adds a closing line at the end: the answer is all of it, checked as one.
  const said: string[] = [];

  const fallback = (reason: string): AgentAnswer =>
    records.length === 0
      ? answerWithoutModel(run.plan, run.before, run.query, run.revision, reason, run.onStep)
      : finishAgentAnswer(state, run.revision, 'fallback', composeFallbackText(state, records), steps, reason);

  for (let turn = 0; turn < AGENT_LIMITS.maxSteps; turn += 1) {
    if (now() > deadline) return fallback('Модель не уложилась во время ответа — показан расчёт без LLM.');
    const answer = await run.chat({ messages, tools: AGENT_TOOL_SPECS });
    if (!answer.ok) {
      return fallback(`Модель недоступна: ${answer.issues[0]?.message ?? 'нет ответа'} Показан расчёт без LLM.`);
    }

    if (answer.value.toolCalls.length > 0) {
      if (answer.value.content !== '') said.push(answer.value.content);
      messages.push({
        role: 'assistant',
        content: answer.value.content,
        toolCalls: answer.value.toolCalls,
        ...(answer.value.reasoning === undefined ? {} : { reasoning: answer.value.reasoning }),
      });
      for (const call of answer.value.toolCalls) {
        let args: unknown;
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          args = undefined;
        }
        const outcome =
          args === undefined
            ? { output: { error: 'Аргументы не в формате JSON.' }, step: { tool: 'plan_overview' as const, label: 'Неверные параметры инструмента', ok: false } }
            : runAgentTool(state, call.name, args);
        steps.push(outcome.step);
        records.push({ name: call.name, output: outcome.output });
        run.onStep(outcome.step);
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.output).slice(0, MAX_TOOL_OUTPUT_CHARS) });
      }
      continue;
    }

    const text = [...said, answer.value.content].join('\n\n').slice(0, AGENT_LIMITS.maxTextChars);
    const problems = checkAgentText(text, agentEvidence(state, records.map((record) => record.output), citedContext));
    if (problems.length === 0) return finishAgentAnswer(state, run.revision, 'llm', text, steps);
    if (repaired) {
      return fallback(`Текст модели не прошёл проверку расчётом (${problems.map((problem) => problem.token).join(', ')}) — показан расчёт без LLM.`);
    }
    repaired = true;
    said.length = 0;
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `${describeProblems(problems)} Напиши ответ целиком заново.` });
  }
  return fallback('Модель не закончила ответ за отведённое число шагов — показан расчёт без LLM.');
}
