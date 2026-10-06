/**
 * D-258: the conversation with the plan agent.
 *
 * Each exchange reads as a work log: the question, the tools the agent ran —
 * folded, open on a click (#252) — and the answer, whose ids are buttons named
 * after the entity that show it on the plan. Under the answer: whether the text
 * passed the check against the calculation, and the actions. Ids and service
 * lines show only in «Отладка» (#252). «Применить вариант» and «Применить
 * правки» (#126) edit the plan, and only when pressed.
 */

import { useEffect, useRef, useState } from 'react';
import type { AgentAnswer, AgentEdit, AgentEditPose, AgentExchange, AssistantAction } from '../../contracts/advice-chat';
import { LIMITS, type PlanDocument, type Ref, type Rule } from '../../contracts/model';
import { QUOTED_ID_PATTERN, WHY_LEAD } from '../../domain/advice';
import { formatShort } from '../../domain/number-format';
import type { PlanIndex } from '../../domain/plan-index';
import { stopAgent } from './agent-client';
import { focusTitle, useDebugMode } from './debug-mode';
import './agent-chat.css';
import { VoiceInput } from './VoiceInput';

const PANEL_NAMES = { metrics: 'Площади', validation: 'Проверка', inventory: 'Инвентаризация' } as const;

/** The three scenarios of the brief and an edit by text (#126), as a person would ask them. */
export const AGENT_EXAMPLES = [
  'Где поставить ещё одно кассовое окно ближе к входу?',
  'Чего не хватает или что лишнее по оборудованию?',
  'Как мои изменения повлияли на свободную площадь?',
  'Добавь скамью для ожидания в зону ожидания',
] as const;

/**
 * Two ways the code writes a plan reference into an answer (D-320): a bare
 * id such as `z_storage` — most of `composeFallbackText`/`renderAgentFact` —
 * or, for text that already quotes a name itself, «name» (id), the same
 * shape `QUOTED_ID_PATTERN` (`domain/advice`) matches — built on here rather
 * than duplicated, so a change to one cannot silently drift from the other.
 * Only a zone or an object turns into a button labelled with its name: a
 * rule or a type is not a plan entity a click can show, so its id stays in
 * the sentence exactly as the calculation wrote it (review of !318, #10).
 */
const ANSWER_REF_PATTERN = new RegExp(
  `${QUOTED_ID_PATTERN.source}|\\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\\b`,
  'gi',
);

type Props = {
  plan: PlanDocument;
  revision: number;
  names: PlanIndex;
  exchanges: readonly AgentExchange[];
  actionStatus: string | null;
  onAsk: (question: string) => void;
  onAction: (action: AssistantAction, answer: AgentAnswer) => void;
  onClear: () => void;
  /** #34: the zone or object selected on the plan — the chat offers questions about it. */
  selection?: Ref | null;
};

/**
 * #34: questions about the selection, with its id in the text. Only what the
 * calculation answers: a place for one more of the same type, a new place for
 * the object itself, the zone's equipment, the zone's contents. The object's own name is left out — its
 * words would steer the zone match («Табло над зоной ожидания»).
 */
export function selectionQuestions(plan: PlanDocument, selection: Ref | null | undefined): string[] {
  const zoneQuestions = (zoneId: string | null, details: boolean): string[] => {
    const zone = plan.zones.find((entry) => entry.id === zoneId);
    if (zone === undefined) return [];
    const title = `«${zone.name}» (${zone.id})`;
    const equipment = `Чего не хватает по оборудованию в зоне ${title}?`;
    return details ? [`Что находится в зоне ${title}?`, equipment] : [equipment];
  };
  if (selection?.kind === 'zone') return zoneQuestions(selection.id, true);
  if (selection?.kind !== 'object') return [];
  const object = plan.objects.find((entry) => entry.id === selection.id);
  if (object === undefined) return [];
  const type = plan.catalog.objectTypes.find((entry) => entry.id === object.typeId);
  return [
    ...(type === undefined ? [] : [`Где разместить ещё такой же объект «${type.label}», как ${object.id}?`]),
    // #178: a new place for this very object — the variants and why one beats another.
    // Not first: «Спросить ассистента» in the object menu asks the first question.
    `Предложить место для ${object.id}: куда перенести и почему?`,
    ...zoneQuestions(object.zoneId, false),
  ];
}

function refFor(plan: PlanDocument, id: string): Ref | null {
  if (plan.zones.some((zone) => zone.id === id)) return { kind: 'zone', id };
  if (plan.objects.some((object) => object.id === id)) return { kind: 'object', id };
  return null;
}

/** A rule has no label: its title is read from its data, as in «Проверка». */
function ruleTitle(rule: Rule, names: PlanIndex): string {
  const type = names.objectTypeLabel(rule.objectTypeId) ?? 'оборудование';
  if (rule.kind === 'distance-to-entrance') return `${type} — не дальше ${formatShort(rule.maxDistance_m, 2)} м от входа`;
  const where = `${type}, зона «${names.zoneTypeLabel(rule.zoneTypeId) ?? 'без названия'}»`;
  if (rule.min !== null && rule.max !== null) return `${where}: от ${rule.min} до ${rule.max}`;
  if (rule.min !== null) return `${where}: не меньше ${rule.min}`;
  if (rule.max !== null) return `${where}: не больше ${rule.max}`;
  return where;
}

/** Ids of the plan's kinds: one the plan no longer has still must not show (#252). */
const PLAN_ID_PREFIX = /^(?:z|eq|ot|zt|l|op|rule)_/i;

/**
 * #252: the name a catalog id or a plan-shaped id reads by without «Отладка»:
 * a type, a zone type, a layer, a rule; «без названия» for an id the plan has
 * not got. Null — not an id, the text stays.
 */
function catalogName(plan: PlanDocument, names: PlanIndex, id: string): string | null {
  const rule = plan.catalog.rules.find((entry) => entry.id === id);
  if (rule !== undefined) return ruleTitle(rule, names);
  return names.objectTypeLabel(id) ?? names.zoneTypeLabel(id) ?? names.layerName(id) ?? (PLAN_ID_PREFIX.test(id) ? 'без названия' : null);
}

/** «name» — or the bare name where the text already has the quotes around the id. */
function quoted(name: string, text: string, start: number, length: number): string {
  return text[start - 1] === '«' && text[start + length] === '»' ? name : `«${name}»`;
}

/**
 * #252: a text as the person reads it without «Отладка» — every id replaced by
 * its name. A question sent keeps the ids: the calculation resolves them.
 */
export function namedText(text: string, plan: PlanDocument, names: PlanIndex): string {
  return text.replace(ANSWER_REF_PATTERN, (whole: string, quotedName: string | undefined, _quotedId: string | undefined, start: number) => {
    if (quotedName !== undefined) return `«${quotedName}»`;
    const ref = refFor(plan, whole);
    const name = ref === null ? catalogName(plan, names, whole) : names.nameOf(ref);
    return name === null ? whole : quoted(name, text, start, whole.length);
  });
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
    // #122: a layout variant is named by its number, plain edits by the old words.
    case 'preview-edits':
    case 'apply-edits': {
      const variant = answer.proposals.find((entry) => entry.id === action.proposalId)?.title?.split(':')[0]?.toLowerCase();
      const verb = action.kind === 'preview-edits' ? 'Показать' : 'Применить';
      return variant === undefined ? `${verb} правки` : `${verb} ${variant}`;
    }
    case 'show-layer':
      return `Включить слой «${names.layerName(action.layerId) ?? action.layerId}»`;
    case 'open-panel':
      return `Открыть «${PANEL_NAMES[action.panel]}»`;
  }
}

/**
 * Answer text with every zone or object turned into a button labelled with
 * its name — never with its id (#10): the id only decides whether a mention
 * is clickable and lands in `title`/`data-ref-id` for whoever needs it.
 */
function AnswerText({ text, plan, names, stale, debug, onFocus }: { text: string; plan: PlanDocument; names: PlanIndex; stale: boolean; debug: boolean; onFocus: (ref: Ref) => void }): React.JSX.Element {
  const paragraphs = text.split(/\n{2,}/).map((paragraph, index) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const match of paragraph.matchAll(ANSWER_REF_PATTERN)) {
      const [whole, quotedName, quotedId] = match;
      // A bare match (no quoted-name group) is the id itself: `whole` is `token`.
      const token = quotedId ?? whole;
      const ref = refFor(plan, token);
      const start = match.index ?? last;
      parts.push(paragraph.slice(last, start));
      if (ref === null) {
        // A rule or a type: the id is not a plan entity a click can show.
        // Without «Отладка» it reads by its name (#252); with it — as the
        // calculation wrote it.
        const name = debug ? null : quotedName ?? catalogName(plan, names, token);
        parts.push(name === null ? whole : quotedName === undefined ? quoted(name, paragraph, start, whole.length) : `«${name}»`);
      } else {
        const label = names.nameOf(ref) ?? quotedName ?? token;
        parts.push(
          <button
            key={start}
            type="button"
            className="agent__id"
            disabled={stale}
            onClick={() => onFocus(ref)}
            title={focusTitle(token, debug)}
            data-ref-id={token}
          >
            {label}
          </button>,
        );
      }
      last = start + whole.length;
    }
    parts.push(paragraph.slice(last));
    return <p key={index} className={index === 0 && text.includes('\n\n') ? 'agent__lead' : undefined}>{parts}</p>;
  });
  // #210: the first paragraph says what to do; the facts behind it are one click away.
  const [lead, ...more] = paragraphs;
  return (
    <div className="agent__text">
      {lead}
      {more.length === 0 ? null : (
        <details className="agent__more">
          <summary>Подробнее</summary>
          {more}
        </details>
      )}
    </div>
  );
}

/** «1 шаг», «2 шага», «5 шагов», «11 шагов». */
function stepsWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'шагов';
  if (ones === 1) return 'шаг';
  if (ones >= 2 && ones <= 4) return 'шага';
  return 'шагов';
}

/** #252: the agent's steps are folded while it works and after; a click or Enter opens them. */
function StepLog({ exchange, working, debug }: { exchange: AgentExchange; working: boolean; debug: boolean }): React.JSX.Element | null {
  const steps = exchange.answer?.steps ?? exchange.steps;
  if (steps.length === 0 && !working) return null;
  const count = `${steps.length} ${stepsWord(steps.length)}`;
  return (
    <details className="agent__log">
      <summary>{working ? (steps.length === 0 ? 'Работаю с планом…' : `Работаю с планом… ${count}`) : `Ход проверки: ${count}`}</summary>
      <ol className="agent__steps">
        {steps.map((step, index) => (
          <li key={index} className={step.ok ? undefined : 'is-failed'}>
            <span className="agent__tick" aria-hidden="true">{step.ok ? '✓' : '×'}</span>
            {step.label}
            {debug ? <> <code>{step.tool}</code></> : null}
            {step.ok ? null : <span className="agent__sr"> — не удалось</span>}
          </li>
        ))}
        {working ? <li className="is-working"><span className="agent__tick" aria-hidden="true">…</span>Работаю с планом</li> : null}
      </ol>
    </details>
  );
}

const OP_NAMES: Record<AgentEdit['op'], string> = { move: 'перемещение', rotate: 'поворот', add: 'новый объект', delete: 'удаление' };

const metres = (value: number): string => formatShort(value, 2);

function poseText(pose: AgentEditPose | null, names: PlanIndex): string {
  if (pose === null) return 'нет';
  const zone = pose.zoneId === null ? 'вне зон' : `зона «${names.zoneName(pose.zoneId) ?? pose.zoneId}»`;
  return `(${metres(pose.position[0])}; ${metres(pose.position[1])}) м, ${pose.rotation_deg}°, ${zone}`;
}

/** What the model asked for, in words: shown next to the reason it was refused. Ids only in «Отладка» (#252). */
function editText(edit: AgentEdit, names: PlanIndex, debug: boolean): string {
  const object = (id: string): string => (debug ? id : `«${names.objectLabel(id) ?? 'без названия'}»`);
  switch (edit.op) {
    case 'move':
      return `сдвинуть ${object(edit.id)} на (${metres(edit.dx_m)}; ${metres(edit.dy_m)}) м`;
    case 'rotate':
      return `повернуть ${object(edit.id)} на ${metres(edit.by_deg)}°`;
    case 'add': {
      const type = debug ? edit.typeId : `«${names.objectTypeLabel(edit.typeId) ?? 'объект'}»`;
      const zone = edit.zoneId === null ? '' : ` в ${debug ? edit.zoneId : `зону «${names.zoneName(edit.zoneId) ?? 'вне плана'}»`}`;
      return `добавить ${type}${zone}`;
    }
    case 'delete':
      return `удалить ${object(edit.id)}`;
  }
}

/** #126: every edit of the answer — «было → стало» with ids, and each refusal with its reason. */
function EditList({ answer, plan, names, debug }: { answer: AgentAnswer; plan: PlanDocument; names: PlanIndex; debug: boolean }): React.JSX.Element | null {
  if (answer.proposals.length === 0) return null;
  return (
    <>
      {answer.proposals.map((proposal) => (
        <div key={proposal.id} className="agent__edits">
          <p className="agent__mode">
            {proposal.title ?? 'Правки'}: принято {proposal.changes.length}, отклонено {proposal.rejected.length}. Проверил код: id, физика, проверка плана.
          </p>
          <ul className="agent__steps" aria-label="Правки: было → стало">
            {proposal.changes.map((change) => (
              <li key={`${change.op}-${change.id}`}>
                <span className="agent__tick" aria-hidden="true">✓</span>
                {debug ? <><code>{change.id}</code>{' '}</> : null}«{change.label}», {OP_NAMES[change.op]}: {poseText(change.before, names)} → {poseText(change.after, names)}
              </li>
            ))}
            {proposal.rejected.map((entry, index) => (
              <li key={`rejected-${index}`} className="is-failed">
                <span className="agent__tick" aria-hidden="true">×</span>
                Отклонено: {editText(entry.edit, names, debug)} — {debug ? entry.reason : namedText(entry.reason, plan, names)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export function AgentChat({ plan, revision, names, exchanges, actionStatus, onAsk, onAction, onClear, selection }: Props): React.JSX.Element {
  const [question, setQuestion] = useState('');
  const debug = useDebugMode();
  const history = useRef<HTMLOListElement>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
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

  const chips = selectionQuestions(plan, selection);
  const selectedName = selection == null ? null : names.nameOf(selection);

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
            // #211: until the model's answer comes, the calculation's draft stands in.
            const answer = exchange.answer ?? exchange.draft ?? null;
            const stale = answer !== null && answer.revision !== revision;
            const pending = exchange.answer === null && exchange.error === null;
            return (
              <li key={exchange.id} className="agent__exchange">
                <p className="agent__question"><span className="agent__who">Вопрос</span>{debug ? exchange.question : namedText(exchange.question, plan, names)}</p>
                <StepLog exchange={exchange} working={pending} debug={debug} />
                {exchange.error === null ? null : <p className="files__error" role="alert">{exchange.error}</p>}
                {answer === null ? null : (
                  <div className={`agent__answer${answer.mode === 'llm' ? '' : ' is-fallback'}`}>
                    <AnswerText text={answer.text} plan={plan} names={names} stale={stale} debug={debug} onFocus={(ref) => onAction({ kind: 'focus', ref }, answer)} />
                    <p className="agent__mode">
                      {answer.mode !== 'llm'
                        ? `Без LLM: ${answer.fallbackReason ?? 'текст собран расчётом.'}`
                        : answer.text.includes(WHY_LEAD)
                          ? 'LLM выбрала рассчитанные факты и написала «почему так». Код сверил в этом тексте каждый id, число и номер варианта с расчётом; остальной текст сформирован кодом.'
                          : 'LLM выбрала рассчитанные факты. Числа, единицы и пояснения сформированы кодом.'}
                    </p>
                    {/* #252: id зон и объектов — только в «Отладке» (как
                        «ID зон и объектов» в карточке рекомендации). Свой
                        класс, не `agent__log`: тот же класс на «Ход проверки»
                        сделал бы оба раскрытия неразличимы для селектора. */}
                    {!debug || answer.refs.length === 0 ? null : (
                      <details className="agent__ids">
                        <summary>ID зон и объектов ({answer.refs.length})</summary>
                        <ul className="agent__steps">
                          {answer.refs.map((ref) => (
                            <li key={`${ref.kind}-${ref.id}`}>
                              <code>{ref.id}</code>
                              {names.nameOf(ref) === null ? null : <span> — {names.nameOf(ref)}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <EditList answer={answer} plan={plan} names={names} debug={debug} />
                    {answer.actions.length === 0 ? null : (
                      <div className="agent__actions" role="group" aria-label="Действия по ответу">
                        {answer.actions
                          .filter((action) => action.kind !== 'focus' || answer.actions.filter((entry) => entry.kind === 'focus').indexOf(action) < 4)
                          .map((action, index) => (
                            <button
                              key={index}
                              type="button"
                              className={action.kind === 'apply-candidate' || action.kind === 'apply-edits' ? 'files__button is-primary' : 'files__button'}
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

      {chips.length === 0 ? null : (
        <div className="agent__chips" role="group" aria-label={`Вопросы о выделенном: ${selectedName ?? selection?.id ?? ''}`}>
          <span className="agent__chips-title">О выделенном{selectedName === null ? '' : ` «${selectedName}»`}:</span>
          {chips.map((chip) => (
            <button key={chip} type="button" className="agent__chip" disabled={working} onClick={() => submit(chip)}>
              {debug ? chip : namedText(chip, plan, names)}
            </button>
          ))}
        </div>
      )}

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
            ref={questionField}
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
          {/* #137: a running request can always be ended — by «Остановить» or by «Новый диалог». */}
          {working ? (
            <button type="button" className="files__button is-primary" onClick={stopAgent}>Остановить</button>
          ) : (
            <button type="submit" className="files__button is-primary" disabled={question.trim() === ''}>Отправить</button>
          )}
          {exchanges.length === 0 ? null : (
            <button
              type="button"
              className="files__button"
              onClick={() => {
                stopAgent();
                onClear();
              }}
            >
              Новый диалог
            </button>
          )}
          <VoiceInput
            onText={(text) =>
              setQuestion((current) => (current.trim() === '' ? text : `${current.trimEnd()} ${text}`).slice(0, LIMITS.maxQueryChars))
            }
            onDone={() => {
              // Caret at the end: Enter sends the recognised question, typing adds to it.
              const field = questionField.current;
              if (field === null) return;
              field.focus();
              field.setSelectionRange(field.value.length, field.value.length);
            }}
          />
          <span className="agent__hint">Enter — отправить, Shift+Enter — перенос</span>
        </div>
      </form>
    </div>
  );
}
