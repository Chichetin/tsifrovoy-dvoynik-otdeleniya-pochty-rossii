import { useMemo } from 'react';
import type { PlanDocument } from '../../contracts/model';
import { checklistItems, type ChecklistItem } from './rule-checklist';

/**
 * Stocking rules against the plan, one line per rule and zone. A line that is
 * not met asks the assistant a ready question when pressed (#31).
 */
export function RuleChecklist({
  document: plan,
  onAsk,
}: {
  document: PlanDocument;
  onAsk: (question: string) => void;
}): React.JSX.Element | null {
  const items = useMemo(() => checklistItems(plan), [plan]);
  if (items.length === 0) return null;
  const unmet = items.filter((item) => !item.met);
  const met = items.filter((item) => item.met);
  return (
    <section className="panel rule-checklist" aria-label="Комплектность" data-testid="rule-checklist">
      <h2 className="panel__title">Комплектность</h2>
      {unmet.length === 0 ? null : (
        <ul className="rule-checklist__list">
          {unmet.map((item) => (
            <li key={item.key} className="rule-checklist__item is-unmet">
              <button
                type="button"
                className="rule-checklist__ask"
                title="Спросить ассистента, что изменить"
                onClick={() => onAsk(item.question)}
              >
                <span aria-hidden="true">✗</span> {lineText(item)}<span className="rule-checklist__sr"> — не выполнено</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {met.length === 0 ? null : (
        <details className="rule-checklist__met">
          <summary>
            <span aria-hidden="true">✓</span>{' '}
            {unmet.length === 0 ? `В норме: все ${items.length}` : `В норме: ${met.length} из ${items.length}`}
          </summary>
          <ul className="rule-checklist__list">
            {met.map((item) => (
              <li key={item.key} className="rule-checklist__item is-met">
                <span title={item.organizerRule ? 'Правило из материалов организаторов' : undefined}>
                  <span aria-hidden="true">✓</span> {lineText(item)}<span className="rule-checklist__sr"> — выполнено</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function lineText(item: ChecklistItem): string {
  return `${item.zoneName}: ${item.typeLabel} ${item.count}/${item.limit}`;
}
