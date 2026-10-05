/**
 * #225: the right-column card of a selected finding: the rule, what is wrong,
 * what to do. It replaces «Свойства» while a finding is open; the object stays
 * highlighted on the plan. Text only: the fix preview lives in «Проверка».
 */

import type { Ref, PlanDocument } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';
import type { ValidationIssue } from '../../domain/validation';
import { explainFinding, planFix, type FixPlan } from './finding-why';
import { FindingMessage } from './ValidationPanel';

function advice(plan: PlanDocument, fix: FixPlan): string {
  switch (fix.kind) {
    case 'add':
      return `Добавьте объект «${findObjectType(plan.catalog, fix.typeId)?.label ?? fix.typeId}» в зону.`;
    case 'move':
      return fix.toEntrance
        ? `Переставьте «${fix.object.label}» ближе ко входу.`
        : `Переставьте «${fix.object.label}» так, чтобы нарушение ушло.`;
    case 'remove':
      return `Удалите лишний объект «${fix.object.label}».`;
    default:
      return fix.reason;
  }
}

export function FindingCard({
  plan,
  issues,
  allIssues,
  target,
  onClose,
  onShowProps,
}: {
  plan: PlanDocument;
  /** Findings that mention the selected thing. */
  issues: readonly ValidationIssue[];
  allIssues: readonly ValidationIssue[];
  target: Ref;
  onClose: () => void;
  onShowProps: () => void;
}): React.JSX.Element {
  return (
    <div className="shell__props shell__props--alone">
      <div className="shell__props-band">
        <span className="shell__props-caption" role="heading" aria-level={2}>
          Находка проверки
        </span>
        <button
          type="button"
          className="shell__props-close"
          aria-label="Снять выделение"
          title="Снять выделение (Esc)"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="shell__props-body" data-testid="finding-card" data-ref-id={target.id}>
        {issues.map((issue, index) => {
          const why = explainFinding(plan, issue);
          return (
            <section key={`${issue.code}-${index}`} className="panel" aria-label={why.title}>
              <p className="panel__note"><strong>Правило:</strong> {why.title}</p>
              <p className="panel__note"><strong>Что не так:</strong> <FindingMessage message={issue.message} /></p>
              {why.rationale === null ? null : <p className="panel__note">{why.rationale}</p>}
              <p className="panel__note"><strong>Что сделать:</strong> {advice(plan, planFix(plan, issue, allIssues))}</p>
            </section>
          );
        })}
        <p className="issues__refs">
          <button type="button" className="table__link" data-testid="finding-open-props" onClick={onShowProps}>
            Свойства объекта
          </button>
        </p>
      </div>
    </div>
  );
}
