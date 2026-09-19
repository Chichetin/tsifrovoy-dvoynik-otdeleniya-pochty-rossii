/**
 * V02: the list of problems.
 *
 * Errors first, then team warnings, each one clickable straight to the thing
 * it is about — a list that only prints sentences makes the jury hunt for the
 * spot on the plan.
 */

import type { Issue, PlanDocument } from '../../contracts/model';
import type { ValidationPanelProps } from '../../contracts/ui';
import { refName } from './naming';

/**
 * The document is optional: without it the list keeps working and names each
 * finding by id, exactly as it did before names existed.
 */
export type ValidationPanelViewProps = ValidationPanelProps & { document?: PlanDocument };

function order(issue: Issue): number {
  return issue.severity === 'error' ? 0 : 1;
}

/** The raw id after the name: secondary, but never hidden. */
const ID_STYLE = { marginLeft: '6px', fontSize: '12px' } as const;

export function ValidationPanel({
  issues,
  document: plan,
  onFocus,
}: ValidationPanelViewProps): React.JSX.Element {
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
        <ul className="issues">
          {sorted.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`issues__item is-${issue.severity}`}>
              <p className="issues__message">{issue.message}</p>
              <p className="issues__refs">
                <span className="issues__code">{issue.code}</span>
                {issue.refs.map((ref) => {
                  const name = refName(plan, ref);
                  return (
                    <button
                      key={`${ref.kind}-${ref.id}`}
                      type="button"
                      className="table__link"
                      title={ref.id}
                      onClick={() => onFocus(ref)}
                    >
                      {name ?? ref.id}
                      {name === null ? null : (
                        <span className="table__muted" style={ID_STYLE}>
                          {ref.id}
                        </span>
                      )}
                    </button>
                  );
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
