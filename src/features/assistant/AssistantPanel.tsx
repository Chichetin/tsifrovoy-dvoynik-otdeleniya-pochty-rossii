/**
 * A06: the assistant on screen.
 *
 * Everything the panel shows comes from the answer: the sentence is rendered
 * from the verified explanation, the numbers are the facts of the calculation,
 * and the assumptions and limitations are printed next to them rather than
 * hidden behind a tooltip — the jury has to be able to tell our rule from a
 * requirement of Russian Post without reading the code.
 *
 * The panel changes nothing in the plan. Hovering a placement shows it as a
 * translucent preview; moving the object is the user's own action in the
 * editor, because automatic rearrangement is explicitly out of scope.
 */

import { useMemo, useState } from 'react';
import type { AdviceRequest, Candidate, Fact, Recommendation } from '../../contracts/advice';
import { LIMITS, type PlanDocument } from '../../contracts/model';
import type { AssistantAction } from '../../contracts/advice-chat';
import type { AssistantPanelProps } from '../../contracts/ui';
import { renderExplanation } from '../../domain/advice';
import { planIndex, type PlanIndex } from '../../domain/plan-index';
import { formatLength, formatMeasure, formatNumber } from '../../domain/number-format';

type Scenario = AdviceRequest['scenario'];

const SCENARIO_LABELS: Record<Scenario, string> = {
  place: 'Найти место',
  equipment: 'Комплектование',
  compare: 'Эффект изменений',
};

const ACTION_LABELS: Record<AssistantAction['kind'], string> = {
  focus: 'Показать на плане',
  'open-properties': 'Открыть свойства',
  'filter-inventory': 'Открыть в инвентаризации',
  'show-layer': 'Показать слой',
  'preview-candidate': 'Предпросмотр варианта',
};

const METRIC_LABELS: Record<Fact['metric'], string> = {
  'area.total': 'Площадь помещения',
  'area.occupied': 'Занято',
  'area.free': 'Свободно',
  'equipment.count': 'Объектов',
  'equipment.min': 'Минимум по правилу',
  'equipment.max': 'Максимум по правилу',
  'objects.added': 'Добавлено',
  'objects.removed': 'Удалено',
  'placement.distance': 'Расстояние',
};

const PHASE_LABELS: Record<Fact['phase'], string> = {
  current: 'сейчас',
  before: 'было',
  after: 'станет',
  delta: 'разница',
};

function formatValue(fact: Fact): string {
  const unit = fact.unit === 'm2' ? 'м²' : fact.unit === 'm' ? 'м' : 'шт.';
  const digits = fact.unit === 'count' ? 0 : 2;
  const sign = fact.phase === 'delta' && fact.value > 0 ? '+' : '';
  return `${sign}${formatMeasure(fact.value, unit, digits)}`;
}

/** Факты варианта показываются внутри варианта, а не в общем списке. */
function ownFacts(recommendation: Recommendation): Fact[] {
  const owned = new Set(
    recommendation.candidates.flatMap((candidate) => candidate.facts.map((fact) => fact.id)),
  );
  return recommendation.facts.filter((fact) => !owned.has(fact.id));
}

/** Names from the plan's own catalog, so a count has an identifiable subject. */
function equipmentSubject(
  plan: PlanDocument,
  index: PlanIndex,
  recommendation: Recommendation,
): string | null {
  if (recommendation.scenario !== 'equipment') return null;
  const rule = plan.catalog.rules.find(
    (entry) => entry.kind === 'count' && recommendation.ruleIds.includes(entry.id),
  );
  if (rule?.kind !== 'count') return null;
  const type = index.objectTypeLabel(rule.objectTypeId);
  const zoneId = recommendation.refs.find((ref) => ref.kind === 'zone')?.id;
  const zone = zoneId === undefined ? null : index.zoneName(zoneId);
  if (type === null || zone === null) return null;
  return `${type} · ${zone}`;
}

/** Где окажется вариант: имя и id зоны из плана, чтобы его можно было найти. */
function candidateZone(index: PlanIndex, candidate: Candidate): string {
  const zoneId = candidate.object.zoneId;
  if (zoneId === null) return 'вне зон';
  const name = index.zoneName(zoneId);
  return name === null ? `зона ${zoneId}` : `зона «${name}» (${zoneId})`;
}

export function AssistantPanel({
  document: plan,
  revision,
  response,
  state,
  onPreview,
  onFocus,
  onAsk,
  chatTurns = [],
  chatStatus,
  onAskChat,
  onAssistantAction,
}: AssistantPanelProps): React.JSX.Element {
  const [scenario, setScenario] = useState<Scenario>('place');
  const [typeId, setTypeId] = useState<string>(plan.catalog.objectTypes[0]?.id ?? '');
  const [zoneId, setZoneId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  // Пожелание, с которым ушёл последний запрос: без модели оно никуда не попадает —
  // расчёт идёт по сценарию, — и человек должен это увидеть, а не гадать,
  // почему выбран именно этот вариант.
  const [askedQuery, setAskedQuery] = useState<string | null>(null);

  // The panel stays mounted when another file is opened. Its form state may
  // therefore point to a type or zone that belonged only to the previous
  // document. Derive safe values from the document currently on screen: an
  // obsolete choice must never be sent to the assistant.
  const currentTypeId = plan.catalog.objectTypes.some((type) => type.id === typeId)
    ? typeId
    : (plan.catalog.objectTypes[0]?.id ?? '');
  const currentZoneId = zoneId === '' || plan.zones.some((zone) => zone.id === zoneId)
    ? zoneId
    : '';
  const placeUnavailable = scenario === 'place' && currentTypeId === '';

  // One index per document: names for every recommendation and candidate (D-202).
  const names = useMemo(() => planIndex(plan), [plan]);
  const stale = response !== null && response.revision !== revision;
  const latestTurn = chatTurns.at(-1);
  const chatStale = latestTurn !== undefined && latestTurn.revision !== revision;
  const busy = state.status === 'loading';
  const status = busy ? 'Считаем рекомендации…'
    : stale || chatStale ? 'План изменился после этого ответа: спросите заново, числа устарели. Действия отключены.'
    : chatStatus ?? (latestTurn?.intent.kind === 'clarify' ? `Уточните: ${latestTurn.intent.question}`
      : state.status === 'done' ? 'Ответ готов. Проверьте основания и выберите действие.' : '');

  function ask(): void {
    if (placeUnavailable) return;
    setAskedQuery(query.trim() === '' ? null : query.trim());
    if (scenario === 'place') {
      onAsk(
        { scenario: 'place', typeId: currentTypeId, zoneId: currentZoneId === '' ? null : currentZoneId },
        query.trim() === '' ? undefined : query.trim(),
      );
      return;
    }
    if (scenario === 'equipment') {
      onAsk(
        { scenario: 'equipment', zoneId: currentZoneId === '' ? null : currentZoneId },
        query.trim() === '' ? undefined : query.trim(),
      );
      return;
    }
    // Снимком «до» владеет store: панель выбирает сценарий, но не подставляет
    // фиктивный текущий документ вместо истории.
    onAsk({ scenario: 'compare' }, query.trim() === '' ? undefined : query.trim());
  }

  return (
    <section className="panel assistant" aria-label="Ассистент">
      <h2 className="panel__title">Ассистент</h2>

      {onAskChat !== undefined ? (
        <>
          <ol className="assistant__history" aria-label="История диалога">
            {chatTurns.map((turn) => (
              <li key={turn.id}>
                <span>{turn.intent.kind === 'clarify' ? turn.intent.question : SCENARIO_LABELS[turn.intent.request.scenario]}</span>
                {turn.revision !== revision ? <span className="assistant__history-note">План изменён — пересчитайте вывод</span> : null}
              </li>
            ))}
          </ol>
          <form className="assistant__form" onSubmit={(event) => {
            event.preventDefault();
            if (!busy && chatQuery.trim()) onAskChat(chatQuery.trim());
          }}>
            <label className="assistant__field">
              Вопрос ассистенту
              <textarea name="assistant-question" autoComplete="off" rows={2} value={chatQuery} maxLength={LIMITS.maxQueryChars}
                placeholder="Например: где добавить рабочее место?"
                onChange={(event) => setChatQuery(event.target.value)} />
            </label>
            <button type="submit" className="files__button is-primary" disabled={busy || !chatQuery.trim()}>Отправить</button>
          </form>
        </>
      ) : null}
      <p className={stale || chatStale ? 'assistant__stale' : 'assistant__status'} role="status" aria-live="polite" aria-atomic="true">{status}</p>
      <details className="assistant__quick" open={chatTurns.length === 0}>
      <summary>Быстрый расчёт по сценарию</summary>
      <div className="assistant__form">
        <label className="assistant__field">
          Сценарий
          <select
            value={scenario}
            onChange={(event) => setScenario(event.target.value as Scenario)}
          >
            {Object.entries(SCENARIO_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {scenario === 'place' ? (
          <label className="assistant__field">
            Объект
            <select
              value={currentTypeId}
              disabled={placeUnavailable}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {placeUnavailable ? <option value="">Нет типов в справочнике</option> : null}
              {plan.catalog.objectTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {scenario === 'compare' ? null : (
          <label className="assistant__field">
            Зона
            <select value={currentZoneId} onChange={(event) => setZoneId(event.target.value)}>
              <option value="">Всё помещение</option>
              {plan.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="assistant__field">
          Пожелание к варианту (необязательно)
          <input
            type="text"
            value={query}
            placeholder="Например: ближе к главному входу"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="files__button is-primary"
          onClick={ask}
          disabled={state.status === 'loading' || placeUnavailable}
          title={placeUnavailable ? 'Сначала добавьте тип оборудования в справочник' : undefined}
        >
          {state.status === 'loading' ? 'Считаем…' : 'Спросить'}
        </button>
        {placeUnavailable ? (
          <p className="panel__empty">
            Для поиска места сначала добавьте тип оборудования в справочник.
          </p>
        ) : null}
      </div>
      </details>

      {state.status === 'error' ? (
        <p className="files__error" role="alert">
          {state.message}
        </p>
      ) : null}

      {response === null ? (
        <p className="panel__empty">
          {latestTurn?.intent.kind === 'clarify' ? 'Ответьте на уточнение в поле вопроса.' : state.status === 'loading' ? 'Считаем рекомендации…' : 'Ответа пока нет'}
        </p>
      ) : (
        <>
          <h3 className="assistant__subheading">Вывод</h3>
          <p className={response.mode === 'llm' ? 'assistant__mode' : 'assistant__mode is-fallback'}>
            {response.mode === 'llm'
              ? 'Объяснение модели проверено расчётом'
              : `Без LLM: ${response.fallbackReason ?? 'показан расчёт'}`}
            {response.mode !== 'llm' && askedQuery !== null ? (
              <span data-testid="assistant-query-ignored">
                {' '}
                Пожелание «{askedQuery}» без модели не учитывается — показан расчёт по выбранному сценарию.
              </span>
            ) : null}
          </p>

          {response.recommendations.length === 0 ? (
            <p className="panel__empty">Расчёт не нашёл, что предложить по этому запросу</p>
          ) : null}

          <h3 className="assistant__subheading">Предложения</h3>

          {response.recommendations.map((recommendation) => {
            const explanation = response.explanations.find(
              (entry) => entry.recommendationId === recommendation.id,
            );
            const sentence =
              explanation === undefined ? null : renderExplanation(recommendation, explanation);
            const subject = equipmentSubject(plan, names, recommendation);

            return (
              <article key={recommendation.id} className="advice">
                <p className="advice__sentence">
                  {subject === null ? null : <><strong>{subject}.</strong>{' '}</>}
                  {sentence ?? 'Объяснение недоступно — ниже расчёт, на который оно опиралось.'}
                </p>

                <h4 className="assistant__subheading">Основание</h4>
                <ul className="advice__facts">
                  {ownFacts(recommendation).map((fact) => (
                    <li key={fact.id}>
                      <span>
                        {METRIC_LABELS[fact.metric]} ({PHASE_LABELS[fact.phase]})
                      </span>
                      <b>{formatValue(fact)}</b>
                    </li>
                  ))}
                </ul>

                {recommendation.candidates.length === 0 ? null : (
                  <ol className="advice__candidates">
                    {recommendation.candidates.map((candidate: Candidate, index) => (
                      <li
                        key={candidate.id}
                        onMouseEnter={() => { if (!stale) onPreview(candidate); }}
                        onMouseLeave={() => onPreview(null)}
                      >
                        <span>
                          Вариант {index + 1}: {formatNumber(candidate.object.position[0])};{' '}
                          {formatLength(candidate.object.position[1])}, поворот{' '}
                          {candidate.object.rotation_deg}°
                        </span>
                        <span className="advice__zone" data-testid="candidate-zone">
                          {candidateZone(names, candidate)}
                        </span>
                        <span className="advice__forecast">
                          {candidate.facts
                            .filter((fact) => fact.phase === 'after')
                            .map((fact) => `${METRIC_LABELS[fact.metric]}: ${formatValue(fact)}`)
                            .join(', ')}
                        </span>
                        <button type="button" className="table__link" disabled={stale}
                          onClick={() => onPreview(candidate)}>Показать вариант {index + 1}</button>
                      </li>
                    ))}
                  </ol>
                )}

                {recommendation.changes.length === 0 ? null : (
                  <ul className="advice__changes">
                    {recommendation.changes.map((change) => (
                      <li key={`${change.ref.kind}-${change.ref.id}-${change.kind}`}>
                        <button
                          type="button"
                          className="table__link"
                          disabled={stale}
                          onClick={() => onFocus(change.ref)}
                        >
                          {change.ref.id}
                        </button>
                        <span>{change.kind}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="advice__refs">
                  {recommendation.refs.map((ref) => (
                    <button
                      key={`${ref.kind}-${ref.id}`}
                      type="button"
                      className="table__link"
                      disabled={stale}
                      onClick={() => onFocus(ref)}
                    >
                      {ref.id}
                    </button>
                  ))}
                </p>

                {recommendation.assumptions.length === 0 ? null : (
                  <details className="advice__more">
                    <summary>Допущения и правила ({recommendation.assumptions.length})</summary>
                    <ul>
                      {recommendation.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </details>
                )}

                <ul className="advice__limitations">
                  {recommendation.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </>
      )}
      {latestTurn?.selection !== null && latestTurn?.selection !== undefined ? (
        <div className="assistant__actions">
          <h3>Действие</h3>
          <p>Проверенные переходы к плану</p>
          {latestTurn.selection.selections.flatMap((entry) => entry.actions).map((action, index) => (
            <button key={index} type="button" className="files__button assistant__route"
              disabled={chatStale || stale || busy || onAssistantAction === undefined}
              onClick={() => onAssistantAction?.(action)}>
              <span aria-hidden="true">→ </span>{ACTION_LABELS[action.kind]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
