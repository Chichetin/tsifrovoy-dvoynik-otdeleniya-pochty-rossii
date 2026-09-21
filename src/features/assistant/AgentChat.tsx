/**
 * D-255: the conversation with the plan agent.
 *
 * Each exchange reads as a work log: the question, the tools the agent ran —
 * live while it works — and the answer, whose ids are buttons that show the
 * entity on the plan. Under the answer: whether the text passed the check
 * against the calculation, and the actions. «Применить вариант» is the only
 * one that edits the plan, and only when pressed.
 */

import { useEffect, useRef, useState } from 'react';
import type { AgentAnswer, AgentExchange, AssistantAction } from '../../contracts/advice-chat';
import { LIMITS, type PlanDocument, type Ref } from '../../contracts/model';
import type { PlanIndex } from '../../domain/plan-index';

const PANEL_NAMES = { metrics: 'Площади', validation: 'Проверка', inventory: 'Инвентаризация' } as const;

/** The three scenarios of the brief, as a person would ask them. */
export const AGENT_EXAMPLES = [
  'Где поставить ещё одно кассовое окно ближе к входу?',
  'Чего не хватает или что лишнее по оборудованию?',
  'Как мои изменения повлияли на свободную площадь?',
] as const;

const ID_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi;

type Props = {
  plan: PlanDocument;
  revision: number;
  names: PlanIndex;
  exchanges: readonly AgentExchange[];
  actionStatus: string | null;
  onAsk: (question: string) => void;
  onAction: (action: AssistantAction, answer: AgentAnswer) => void;
  onClear: () => void;
};

function refFor(plan: PlanDocument, id: string): Ref | null {
  if (plan.zones.some((zone) => zone.id === id)) return { kind: 'zone', id };
  if (plan.objects.some((object) => object.id === id)) return { kind: 'object', id };
  return null;
}

function actionLabel(action: AssistantAction, answer: AgentAnswer, names: PlanIndex): string {
  switch (action.kind) {
    case 'focus':
      return `Показать: ${names.nameOf(action.ref) ?? action.ref.id}`;
    case 'preview-candidate':
      return 'Показать вариант';
    case 'apply-candidate': {
      const candidate = answer.recommendations
        .find((entry) => entry.id === action.recommendationId)
        ?.candidates.find((entry) => entry.id === action.candidateId);
      return `Применить: ${candidate?.object.label ?? 'вариант'}`;
    }
    case 'show-layer':
      return `Включить слой «${names.layerName(action.layerId) ?? action.layerId}»`;
    case 'open-panel':
      return `Открыть «${PANEL_NAMES[action.panel]}»`;
  }
}

/** Answer text with every plan id turned into a button that shows it. */
function AnswerText({ text, plan, stale, onFocus }: { text: string; plan: PlanDocument; stale: boolean; onFocus: (ref: Ref) => void }): React.JSX.Element {
  return (
    <div className="agent__text">
      {text.split(/\n{2,}/).map((paragraph, index) => {
        const parts: React.ReactNode[] = [];
        let last = 0;
        for (const match of paragraph.matchAll(ID_PATTERN)) {
          const ref = refFor(plan, match[0]);
          if (ref === null) continue;
          parts.push(paragraph.slice(last, match.index));
          parts.push(
            <button key={match.index} type="button" className="agent__id" disabled={stale} onClick={() => onFocus(ref)} title="Показать на плане">
              {match[0]}
            </button>,
          );
          last = match.index + match[0].length;
        }
        parts.push(paragraph.slice(last));
        return <p key={index}>{parts}</p>;
      })}
    </div>
  );
}

function StepLog({ exchange, working }: { exchange: AgentExchange; working: boolean }): React.JSX.Element | null {
  const steps = exchange.answer?.steps ?? exchange.steps;
  if (steps.length === 0 && !working) return null;
  const list = (
    <ol className="agent__steps">
      {steps.map((step, index) => (
        <li key={index} className={step.ok ? undefined : 'is-failed'}>
          <span className="agent__tick" aria-hidden="true">{step.ok ? '✓' : '×'}</span>
          {step.label}
          {step.ok ? null : <span className="agent__sr"> — не удалось</span>}
        </li>
      ))}
      {working ? <li className="is-working"><span className="agent__tick" aria-hidden="true">…</span>Работаю с планом</li> : null}
    </ol>
  );
  if (working) return list;
  return (
    <details className="agent__log">
      <summary>Ход проверки: {steps.length} {steps.length === 1 ? 'шаг' : steps.length < 5 ? 'шага' : 'шагов'}</summary>
      {list}
    </details>
  );
}

export function AgentChat({ plan, revision, names, exchanges, actionStatus, onAsk, onAction, onClear }: Props): React.JSX.Element {
  const [question, setQuestion] = useState('');
  const history = useRef<HTMLOListElement>(null);
  // New steps and answers arrive at the bottom of the log: keep them in view.
  useEffect(() => {
    const element = history.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [exchanges]);
  const working = exchanges.some((exchange) => exchange.answer === null && exchange.error === null);
  const latest = exchanges.at(-1);
  const latestStale = latest?.answer != null && latest.answer.revision !== revision;
  // The result of the button just pressed outranks the stale note: after
  // «Применить» the plan has changed precisely because the person applied it.
  const status = working
    ? 'Ассистент работает с планом…'
    : actionStatus ?? (latestStale ? 'План изменился после ответа — спросите заново, действия отключены.' : '');

  function submit(text: string): void {
    const trimmed = text.trim();
    if (trimmed === '' || working) return;
    onAsk(trimmed);
    setQuestion('');
  }

  return (
    <div className="agent" aria-busy={working}>
      {exchanges.length === 0 ? (
        <div className="agent__intro">
          <p>Спросите о плане обычной фразой. Ассистент сам посчитает площади, найдёт место, проверит комплектование и покажет результат на плане.</p>
          <ul className="agent__examples" aria-label="Примеры вопросов">
            {AGENT_EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" className="agent__example" onClick={() => submit(example)}>{example}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol ref={history} className="agent__history" aria-label="Диалог с ассистентом">
          {exchanges.map((exchange) => {
            const answer = exchange.answer;
            const stale = answer !== null && answer.revision !== revision;
            const pending = answer === null && exchange.error === null;
            return (
              <li key={exchange.id} className="agent__exchange">
                <p className="agent__question"><span className="agent__who">Вопрос</span>{exchange.question}</p>
                <StepLog exchange={exchange} working={pending} />
                {exchange.error === null ? null : <p className="files__error" role="alert">{exchange.error}</p>}
                {answer === null ? null : (
                  <div className={`agent__answer${answer.mode === 'llm' ? '' : ' is-fallback'}`}>
                    <AnswerText text={answer.text} plan={plan} stale={stale} onFocus={(ref) => onAction({ kind: 'focus', ref }, answer)} />
                    <p className="agent__mode">
                      {answer.mode === 'llm'
                        ? 'Текст модели сверен с расчётом: все числа и id взяты из результатов инструментов.'
                        : `Без LLM: ${answer.fallbackReason ?? 'текст собран расчётом.'}`}
                    </p>
                    {answer.actions.length === 0 ? null : (
                      <div className="agent__actions" role="group" aria-label="Действия по ответу">
                        {answer.actions
                          .filter((action) => action.kind !== 'focus' || answer.actions.filter((entry) => entry.kind === 'focus').indexOf(action) < 4)
                          .map((action, index) => (
                            <button
                              key={index}
                              type="button"
                              className={action.kind === 'apply-candidate' ? 'files__button is-primary' : 'files__button'}
                              disabled={stale || working}
                              onClick={() => onAction(action, answer)}
                            >
                              {actionLabel(action, answer, names)}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className={latestStale && actionStatus === null ? 'assistant__stale' : 'agent__status'} role="status" aria-atomic="true">{status}</p>

      <form
        className="agent__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
      >
        <label className="assistant__field">
          Вопрос ассистенту
          <textarea
            name="agent-question"
            rows={2}
            value={question}
            maxLength={LIMITS.maxQueryChars}
            placeholder="Например: где добавить рабочее место оператора?"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit(question);
              }
            }}
          />
        </label>
        <div className="agent__form-row">
          <button type="submit" className="files__button is-primary" disabled={working || question.trim() === ''}>
            {working ? 'Работаю…' : 'Отправить'}
          </button>
          {exchanges.length === 0 ? null : (
            <button type="button" className="files__button" disabled={working} onClick={onClear}>Новый диалог</button>
          )}
          <span className="agent__hint">Enter — отправить, Shift+Enter — перенос</span>
        </div>
      </form>
    </div>
  );
}
