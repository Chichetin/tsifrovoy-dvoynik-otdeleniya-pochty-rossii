import { useMemo } from 'react';
import type { PlanDocument } from '../../contracts/model';
import { checklistItems } from './rule-checklist';

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
  return (
    <section className="panel rule-checklist" aria-label="Комплектность" data-testid="rule-checklist">
      <h2 className="panel__title">Комплектность</h2>
      <ul className="rule-checklist__list">
        {items.map((item) => {
          const text = `${item.zoneName}: ${item.typeLabel} ${item.count}/${item.limit}`;
          return (
            <li key={item.key} className={item.met ? 'rule-checklist__item is-met' : 'rule-checklist__item is-unmet'}>
              {item.met ? (
                <span title={item.organizerRule ? 'Правило из материалов организаторов' : undefined}>
                  <span aria-hidden="true">✓</span> {text}<span className="rule-checklist__sr"> — выполнено</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="rule-checklist__ask"
                  title="Спросить ассистента, что изменить"
                  onClick={() => onAsk(item.question)}
                >
                  <span aria-hidden="true">✗</span> {text}<span className="rule-checklist__sr"> — не выполнено</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="props__hint">
        Правила команды, не норматив Почты. Нажмите на невыполненное — ассистент подскажет, что изменить.
      </p>
    </section>
  );
}
