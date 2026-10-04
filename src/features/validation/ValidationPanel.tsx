/**
 * V02: the list of problems.
 *
 * Errors first, then team warnings, each one clickable straight to the thing
 * it is about — a list that only prints sentences makes the jury hunt for the
 * spot on the plan.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Issue, PlanDocument, Ref } from '../../contracts/model';
import type { FocusRequest, ValidationPanelProps } from '../../contracts/ui';
import { EMPTY_INDEX, planIndex } from '../../domain/plan-index';
import { PHYSICS_RULES } from '../../domain/physics';
import type { ValidationIssue } from '../../domain/validation';
import { type IssueGroup, groupIssuesBySubject } from './issue-highlight';

/**
 * The document is optional: without it the list keeps working and names each
 * finding by id, exactly as it did before names existed.
 */
export type ValidationPanelViewProps = Omit<ValidationPanelProps, 'issues'> & {
  issues: ValidationIssue[];
  document?: PlanDocument;
  /**
   * A click on the plan's marker or an agent's ring (V02-marker-click):
   * scrolls to and outlines every finding about this entity. `sequence`
   * fires the scroll again for a repeated click on the same marker.
   */
  focus?: FocusRequest | null;
};

function order(issue: Issue): number {
  return issue.severity === 'error' ? 0 : 1;
}

function mentions(issue: ValidationIssue, ref: Ref): boolean {
  return issue.refs.some((entry) => entry.kind === ref.kind && entry.id === ref.id);
}

/** Links of a grouped row: each entity once, in order of first mention. */
function uniqueRefs(issues: ValidationIssue[]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const issue of issues) {
    for (const ref of issue.refs) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

export function ValidationPanel({
  issues,
  document: plan,
  onFocus,
  focus,
}: ValidationPanelViewProps): React.JSX.Element {
  const [showTechnical, setShowTechnical] = useState(false);
  // One index per document (D-202): names come from the plan itself, so a
  // rename in the card renames the finding; an id with nothing behind it
  // stays raw.
  const names = useMemo(() => (plan === undefined ? EMPTY_INDEX : planIndex(plan)), [plan]);
  const sorted = [...issues].sort((a, b) => order(a) - order(b));
  // #14: all findings about one object form one row with a list, the same
  // grouping the plan's marker counts.
  const groups = groupIssuesBySubject(sorted);
  const errors = issues.filter((issue) => issue.severity === 'error').length;

  // The column may be scrolled past the row a marker click asks about; the
  // row comes to the viewer, the same way «Свойства» does for a card.
  const firstMatch = useRef<HTMLLIElement>(null);
  const groupMentions = (group: IssueGroup<ValidationIssue>, ref: Ref): boolean =>
    group.issues.some((issue) => mentions(issue, ref));
  const matchIndex = focus == null ? -1 : groups.findIndex((group) => groupMentions(group, focus.ref));
  const focusSequence = focus?.sequence ?? null;
  useEffect(() => {
    if (focusSequence === null) return;
    firstMatch.current?.scrollIntoView({ block: 'nearest' });
  }, [focusSequence]);

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
            {groups.map((group, index) => {
              const isMatch = focus != null && groupMentions(group, focus.ref);
              const first = group.issues[0];
              const refs = uniqueRefs(group.issues);
              const subject = group.ref === null ? '' : (names.nameOf(group.ref) ?? group.ref.id);
              return (
                <li
                  key={`${first?.code ?? 'group'}-${index}`}
                  ref={index === matchIndex ? firstMatch : undefined}
                  className={`issues__item is-${group.severity}${isMatch ? ' is-focused' : ''}`}
                  aria-current={isMatch ? 'true' : undefined}
                >
                  {group.issues.length === 1 ? (
                    <p className="issues__message">{first?.message}</p>
                  ) : (
                    <>
                      <p className="issues__message">
                        <strong>{subject}</strong> — нарушений: {group.issues.length}
                      </p>
                      <ul className="issues__group" style={{ margin: '0 0 4px', paddingLeft: 18 }}>
                        {group.issues.map((issue, line) => (
                          <li key={`${issue.code}-${line}`} className="issues__message">
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {refs.length === 0 ? null : (
                    <p className="issues__refs">
                      {refs.map((ref) => {
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
                  {showTechnical
                    ? group.issues.map((issue, line) => (
                        <TechnicalDetails key={`${issue.code}-${line}`} issue={issue} />
                      ))
                    : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* D-286: набор правил физики — то, чего план не может нарушить и
          остаться сохраняемым. Список читается из `PHYSICS_RULES`, а не
          переписан здесь словами: новое правило появляется в панели само. */}
      <details className="issues__physics" data-testid="physics-rules">
        <summary>Правила физики ({PHYSICS_RULES.length})</summary>
        <p className="panel__note">
          Нарушение любого из них останавливает сохранение плана файлом и не даёт поставить
          объект. Это допущения команды, а не нормативы Почты.
        </p>
        <dl>
          {PHYSICS_RULES.map((rule) => (
            <div key={rule.id}>
              <dt>{rule.title}</dt>
              <dd>{rule.detail}</dd>
            </div>
          ))}
        </dl>
      </details>
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
