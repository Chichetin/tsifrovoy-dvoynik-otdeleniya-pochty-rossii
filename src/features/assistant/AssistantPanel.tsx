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
import type { PlanDocument, Ref } from '../../contracts/model';
import type { AssistantPanelProps } from '../../contracts/ui';
import { hideNamedIds, placementZonePath, renderExplanation } from '../../domain/advice';
import { AgentChat } from './AgentChat';
import { EditHints } from './EditHints';
import { PlaceSuggestion } from './PlaceSuggestion';
import { planIndex, type PlanIndex } from '../../domain/plan-index';
import { formatLength, formatMeasure, formatNumber } from '../../domain/number-format';

type Scenario = AdviceRequest['scenario'];

const SCENARIO_LABELS: Record<Scenario, string> = {
  place: 'Найти место',
  equipment: 'Комплектование',
  compare: 'Эффект изменений',
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
  'layout.passage': 'Самый узкий проход',
  'layout.entrance': 'Среднее расстояние до входа',
};

/** Compare has its own meaning for two metrics: a sum of moves and one object's distance to the entrance. */
function metricLabel(fact: Fact, scenario: Recommendation['scenario'], index: PlanIndex): string {
  if (scenario !== 'compare') return METRIC_LABELS[fact.metric];
  if (fact.metric === 'placement.distance') return 'Перемещено объектов, м (сумма)';
  if (fact.metric === 'layout.entrance') {
    const ref = fact.refs[0];
    return `Расстояние до входа: ${ref === undefined ? '' : (index.nameOf(ref) ?? ref.id)}`;
  }
  return METRIC_LABELS[fact.metric];
}

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

/**
 * Где окажется вариант: название зоны из плана (D-320); id остаётся доступен
 * рядом, в раскрытии «ID зон и объектов» карточки (D-323).
 */
function candidateZone(plan: PlanDocument, index: PlanIndex, candidate: Candidate): string {
  const path = placementZonePath(plan, candidate.object);
  if (path.length === 0) return 'вне зон';
  const names = path.map((zoneId) => index.zoneName(zoneId) ?? zoneId);
  return `зона «${names.join(' → ')}»`;
}

/**
 * Every zone or object this recommendation names — its own `refs` and every
 * change's `ref` — deduplicated, in the order they first appear. This is
 * what «какие `id` зон и объектов» (CLAUDE.md, «ИИ-ассистент») asks the
 * card to show: not only clickable buttons named after the entity (D-320),
 * but the ids themselves, visible without opening DevTools (D-323).
 */
function recommendationRefs(recommendation: Recommendation): Ref[] {
  const seen = new Set<string>();
  const refs: Ref[] = [];
  for (const ref of [...recommendation.refs, ...recommendation.changes.map((change) => change.ref)]) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

export function AssistantPanel({
  document: plan,
  revision,
  response,
  state,
  onPreview,
  onFocus,
  onAsk,
  exchanges = [],
  actionStatus = null,
  onAskAgent,
  onAgentAction,
  onClearChat,
  comparison,
  comparisonBusy = false,
  comparisonUnrelated = false,
  selection = null,
}: AssistantPanelProps & { comparison?: React.ReactNode; comparisonBusy?: boolean; comparisonUnrelated?: boolean; selection?: Ref | null }): React.JSX.Element {
  const [scenario, setScenario] = useState<Scenario>('place');
  const [typeId, setTypeId] = useState<string>(plan.catalog.objectTypes[0]?.id ?? '');
  const [zoneId, setZoneId] = useState<string>('');
  const [query, setQuery] = useState('');
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

  // Explains, not just disables: a compare-scenario question can be blocked
  // by the source file still loading or by a source that belongs to a
  // different plan (its object ids are not proven to be the same items).
  const askDisabledTitle = placeUnavailable
    ? 'Сначала добавьте тип оборудования в справочник'
    : scenario === 'compare' && comparisonBusy
      ? 'Дождитесь окончания загрузки исходного файла'
      : scenario === 'compare' && comparisonUnrelated
        ? 'У исходного файла и текущего плана разные id: сопоставление объектов не подтверждено, объяснение недоступно'
        : undefined;

  function ask(): void {
    if (placeUnavailable || (scenario === 'compare' && (comparisonBusy || comparisonUnrelated))) return;
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

      <PlaceSuggestion />

      <EditHints names={names} onFocus={onFocus} onExplain={onAskAgent} />

      {onAskAgent === undefined || onAgentAction === undefined ? null : (
        <>
          <AgentChat
            plan={plan}
            revision={revision}
            names={names}
            exchanges={exchanges}
            actionStatus={actionStatus}
            onAsk={onAskAgent}
            onAction={onAgentAction}
            onClear={onClearChat ?? (() => undefined)}
            selection={selection}
          />
          <h3 className="agent__section">Расчёт по сценарию</h3>
        </>
      )}

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

        {scenario === 'compare' ? comparison : null}

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
          disabled={state.status === 'loading' || placeUnavailable || (scenario === 'compare' && (comparisonBusy || comparisonUnrelated))}
          title={askDisabledTitle}
        >
          {state.status === 'loading' ? 'Считаем…' : 'Спросить'}
        </button>
        {placeUnavailable ? (
          <p className="panel__empty" role="status">
            Для поиска места сначала добавьте тип оборудования в справочник.
          </p>
        ) : null}
      </div>

      {state.status === 'error' ? (
        <p className="files__error" role="alert">
          {state.message}
        </p>
      ) : null}

      {stale ? (
        <p className="assistant__stale" role="status">
          План изменился после этого ответа: спросите заново, числа устарели.
        </p>
      ) : null}

      {response === null ? (
        <p className="panel__empty">
          {state.status === 'loading' ? 'Считаем рекомендации…' : 'Ответа пока нет'}
        </p>
      ) : (
        <>
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

          {response.recommendations.map((recommendation) => {
            const explanation = response.explanations.find(
              (entry) => entry.recommendationId === recommendation.id,
            );
            const sentence =
              explanation === undefined ? null : renderExplanation(recommendation, explanation);
            const subject = equipmentSubject(plan, names, recommendation);
            const idRefs = recommendationRefs(recommendation);

            return (
              <article key={recommendation.id} className="advice">
                <p className="advice__sentence">
                  {subject === null ? null : <><strong>{subject}.</strong>{' '}</>}
                  {sentence ?? 'Объяснение недоступно — ниже расчёт, на который оно опиралось.'}
                </p>

                <ul className="advice__facts">
                  {ownFacts(recommendation).map((fact) => (
                    <li key={fact.id}>
                      <span>
                        {metricLabel(fact, recommendation.scenario, names)} ({PHASE_LABELS[fact.phase]})
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
                        onMouseEnter={() => onPreview(candidate)}
                        onMouseLeave={() => onPreview(null)}
                      >
                        <span>
                          Вариант {index + 1}: {formatNumber(candidate.object.position[0])};{' '}
                          {formatLength(candidate.object.position[1])}, поворот{' '}
                          {candidate.object.rotation_deg}°
                        </span>
                        <span className="advice__zone" data-testid="candidate-zone">
                          {candidateZone(plan, names, candidate)}
                        </span>
                        <span className="advice__forecast">
                          {candidate.facts
                            .filter((fact) => fact.phase === 'after')
                            .map((fact) => `${METRIC_LABELS[fact.metric]}: ${formatValue(fact)}`)
                            .join(', ')}
                        </span>
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
                          title={`Показать на плане · id ${change.ref.id}`}
                          data-ref-id={change.ref.id}
                          onClick={() => onFocus(change.ref)}
                        >
                          {names.nameOf(change.ref) ?? change.ref.id}
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
                      title={`Показать на плане · id ${ref.id}`}
                      data-ref-id={ref.id}
                      onClick={() => onFocus(ref)}
                    >
                      {names.nameOf(ref) ?? ref.id}
                    </button>
                  ))}
                </p>

                {/* D-323: id виден без DevTools — объяснимость (CLAUDE.md,
                    «ИИ-ассистент») требует называть id зон и объектов, а
                    подписи кнопок выше — только их имена. Свой класс, не
                    `advice__more`: тот же класс на «Допущения и правила»
                    сделал бы оба раскрытия неотличимы для `.first()` в
                    существующих e2e (review !318). */}
                {idRefs.length === 0 ? null : (
                  <details className="advice__ids">
                    <summary>ID зон и объектов ({idRefs.length})</summary>
                    <ul>
                      {idRefs.map((ref) => (
                        <li key={`${ref.kind}-${ref.id}`}>
                          <code>{ref.id}</code>
                          {names.nameOf(ref) === null ? null : <span> — {names.nameOf(ref)}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

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
                    <li key={limitation}>{hideNamedIds(limitation)}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
