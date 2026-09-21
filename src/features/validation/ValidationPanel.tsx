/**
 * V02: the list of problems.
 *
 * Errors first, then team warnings, each one clickable straight to the thing
 * it is about — a list that only prints sentences makes the jury hunt for the
 * spot on the plan.
 */

import { useMemo, useState } from 'react';
import type { Issue, PlanDocument } from '../../contracts/model';
import type { ValidationPanelProps } from '../../contracts/ui';
import { EMPTY_INDEX, planIndex } from '../../domain/plan-index';
import type { ValidationIssue } from '../../domain/validation';

/**
 * The document is optional: without it the list keeps working and names each
 * finding by id, exactly as it did before names existed.
 */
export type ValidationPanelViewProps = Omit<ValidationPanelProps, 'issues'> & {
  issues: ValidationIssue[];
  document?: PlanDocument;
};

function order(issue: Issue): number {
  return issue.severity === 'error' ? 0 : 1;
}

export function ValidationPanel({
  issues,
  document: plan,
  onFocus,
}: ValidationPanelViewProps): React.JSX.Element {
  const [showTechnical, setShowTechnical] = useState(false);
  // One index per document (D-202): names come from the plan itself, so a
  // rename in the card renames the finding; an id with nothing behind it
  // stays raw.
  const names = useMemo(() => (plan === undefined ? EMPTY_INDEX : planIndex(plan)), [plan]);
  const sorted = [...issues].sort((a, b) => order(a) - order(b));
  const errors = issues.filter((issue) => issue.severity === 'error').length;

  return (
    <section className="panel" aria-label="Проверка плана">
      <h2 className="panel__title">
        Проверка{' '}
        <span className={errors > 0 ? 'panel__count is-error' : 'panel__count'}>
          {issues.length}
        </span>
      </h2>

      {issues.length === 0 ? (
        <p className="panel__empty">Нарушений не найдено</p>
      ) : (
        <>
          <label className="issues__technical-toggle">
            <input
              type="checkbox"
              checked={showTechnical}
              onChange={(event) => setShowTechnical(event.currentTarget.checked)}
            />
            <span>Показать технические детали</span>
          </label>
          <ul className="issues">
            {sorted.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={`issues__item is-${issue.severity}`}>
                <p className="issues__message">{issue.message}</p>
                {issue.refs.length === 0 ? null : (
                  <p className="issues__refs">
                    {issue.refs.map((ref) => {
                      const name = names.nameOf(ref);
                      const label = name ?? ref.id;
                      return (
                        <button
                          key={`${ref.kind}-${ref.id}`}
                          type="button"
                          className="table__link"
                          title={`Показать на плане: ${label}`}
                          data-ref-id={ref.id}
                          onClick={() => onFocus(ref)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </p>
                )}
                {showTechnical ? <TechnicalDetails issue={issue} /> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TechnicalDetails({ issue }: { issue: ValidationIssue }): React.JSX.Element {
  return (
    <dl className="issues__technical" aria-label="Технические детали находки" translate="no">
      <div>
        <dt>Код</dt>
        <dd><code>{issue.code}</code></dd>
      </div>
      {issue.refs.length === 0 ? null : (
        <div>
          <dt>Ссылки</dt>
          <dd>
            {issue.refs.map((ref) => (
              <code key={`${ref.kind}-${ref.id}`}>{ref.kind}:{ref.id}</code>
            ))}
          </dd>
        </div>
      )}
      {issue.ruleIds === undefined || issue.ruleIds.length === 0 ? null : (
        <div>
          <dt>Правила</dt>
          <dd>
            {issue.ruleIds.map((ruleId) => <code key={ruleId}>{ruleId}</code>)}
          </dd>
        </div>
      )}
      {issue.path === undefined ? null : (
        <div>
          <dt>Путь</dt>
          <dd><code>{issue.path}</code></dd>
        </div>
      )}
    </dl>
  );
}
