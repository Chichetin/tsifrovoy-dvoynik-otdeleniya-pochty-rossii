/**
 * #125: the plan score — a badge for the header and its breakdown on top of
 * «Проверка». Both read `planHealth` of the same findings the list shows, so
 * there is no state of their own: a fixed finding changes the number at once.
 */

import { forwardRef } from 'react';
import type { PlanDocument, Ref } from '../../contracts/model';
import type { PlanIndex } from '../../domain/plan-index';
import {
  HEALTH_MAX,
  SEVERITY_PENALTY,
  type PlanHealth,
  healthLineRefs,
  VALIDATION_ISSUE_CODES,
} from '../../domain/validation';
import { explainFinding } from './finding-why';

/** Plain-language names for catalog-rule findings; the code stays in the tooltip. */
const RULE_LINE_TITLES: Readonly<Record<string, string>> = {
  [VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN]: 'Оборудования меньше нормы комплектования',
  [VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX]: 'Оборудования больше нормы комплектования',
  [VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE]: 'Объект дальше допустимого расстояния от входа',
  [VALIDATION_ISSUE_CODES.RULE_ENTRANCE_MISSING]: 'Для правила не найден вход',
};

export const HEALTH_NOTE = 'Правило команды, не норматив Почты.';

function tone(health: PlanHealth): 'error' | 'warning' | 'ok' {
  if (health.lines.some((line) => line.severity === 'error')) return 'error';
  return health.lines.length > 0 ? 'warning' : 'ok';
}

export function HealthBadge({
  health,
  empty = false,
  onOpen,
}: {
  health: PlanHealth;
  empty?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`health-badge is-${empty ? 'warning' : tone(health)}`}
      data-testid="health-badge"
      title={`Балл плана: 100 минус штрафы находок проверки. ${HEALTH_NOTE} Нажмите — разбор во вкладке «Проверка».`}
      onClick={onOpen}
    >
      {empty ? 'План пуст: нечего проверять' : `План ${health.score}/${HEALTH_MAX}`}
    </button>
  );
}

type BreakdownProps = {
  health: PlanHealth;
  plan?: PlanDocument;
  empty?: boolean;
  names: PlanIndex;
  onFocus: (ref: Ref) => void;
};

/** The header badge opens it and moves focus to its summary. */
export const HealthBreakdown = forwardRef<HTMLDetailsElement, BreakdownProps>(
  function HealthBreakdown({ health, plan, empty = false, names, onFocus }, ref) {
    return (
      <details
        ref={ref}
        className="health"
        data-testid="health-breakdown"
      >
        <summary>
          Балл плана:{' '}
          {empty ? <strong>нечего проверять</strong> : <strong>{health.score}/{HEALTH_MAX}</strong>}
        </summary>
        <p className="panel__note">
          100 минус штраф за каждую находку: ошибка −{SEVERITY_PENALTY.error}, предупреждение −
          {SEVERITY_PENALTY.warning}. <em>{HEALTH_NOTE}</em>
        </p>
        {empty ? (
          <p className="panel__note" data-testid="health-empty">
            В плане нет зон и оборудования, поэтому 100 здесь — не оценка: нечего проверять.
          </p>
        ) : null}
        {health.lines.length === 0 ? (
          <p className="panel__note">Находок нет — штрафов нет.</p>
        ) : (
          <>
            <ul className="health__lines">
              {health.lines.map((line) => {
                const first = line.issues[0];
                const title =
                  RULE_LINE_TITLES[line.code] ??
                  (plan === undefined || first === undefined ? 'Проверка плана' : explainFinding(plan, first).title);
                const tech = line.code;
                const refs = healthLineRefs(line);
                return (
                  <li key={`${line.code}|${line.severity}|${line.ruleIds.join(',')}`} className={`health__line is-${line.severity}`}>
                    <span className="health__title" title={tech}>
                      {title}
                    </span>
                    <span className="health__penalty">
                      {line.issues.length > 1 ? `${line.issues.length} × −${line.weight} = ` : ''}−{line.penalty}
                    </span>
                    {refs.length === 0 ? null : (
                      <span className="issues__refs health__refs">
                        {refs.map((entry) => (
                          <button
                            key={`${entry.kind}-${entry.id}`}
                            type="button"
                            className="table__link"
                            title="Показать на плане"
                            onClick={() => onFocus(entry)}
                          >
                            {names.nameOf(entry) ?? entry.id}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="panel__note" data-testid="health-total">
              Итого снято: {health.penalty}.{' '}
              {health.clamped
                ? `Это больше ${HEALTH_MAX}, поэтому балл остановлен на 0.`
                : `${HEALTH_MAX} − ${health.penalty} = ${health.score}.`}
            </p>
          </>
        )}
      </details>
    );
  },
);
