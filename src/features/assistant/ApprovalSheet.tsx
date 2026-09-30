/**
 * S2-39 (#35): the one page a manager signs — plan before/after, changes by
 * name, the effect the calculation can vouch for, and a stamp. Печать —
 * `window.print()` from the browser; «Сохранить как PDF» is the browser's own
 * print dialog, so no PDF library is added here.
 *
 * A local dialog, not `files/FileDialog`: a feature does not import a sibling
 * feature (`docs/project-structure.md`). The focus trap below repeats that
 * one's shape on purpose, so the two dialogs in the app behave the same way
 * without sharing a file neither owns.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PlanDocument } from '../../contracts/model';
import type { ComparisonMetric } from '../../domain/plan-comparison';
import { formatNumber } from '../../domain/number-format';
import { buildApprovalSheet } from './approval-sheet';

const METRIC_LABELS: Record<ComparisonMetric, string> = {
  'area.total': 'Площадь помещения, м²',
  'area.occupied': 'Занято оборудованием, м²',
  'area.free': 'Свободно, м²',
  'equipment.count': 'Объектов в инвентаризации, шт.',
  'issues.error': 'Ошибок проверки, шт.',
  'issues.warning': 'Предупреждений проверки, шт.',
};

const CHANGE_LABELS = { added: 'Добавлен', removed: 'Удалён', moved: 'Перемещён', updated: 'Обновлён' };

const RULE_NOTE = 'Допущения и правила расчёта — решение команды, не норматив Почты России.';

export type ApprovalSheetProps = {
  /** База «до» — выбранный файл сравнения или сессия открытия/сохранения (как в ComparisonPanel). */
  before: PlanDocument;
  after: PlanDocument;
  /** Как названа база «до» на экране: имя файла или «состояние при открытии…». */
  beforeSource: string;
  onClose: () => void;
};

function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')).filter(
    (el) => !el.disabled,
  );
}

function today(): string {
  return new Date().toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ApprovalSheet({ before, after, beforeSource, onClose }: ApprovalSheetProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [author, setAuthor] = useState('');
  const titleId = useId();
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const items = focusables(dialog);
      if (items.length === 0) return;
      const at = items.indexOf(window.document.activeElement as HTMLElement);
      const target = event.shiftKey
        ? at <= 0 ? items.at(-1)! : items[at - 1]!
        : at === -1 || at === items.length - 1 ? items[0]! : items[at + 1]!;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Typing in «Автор» re-renders the panel on every keystroke; the SVGs and
  // the comparison must not be rebuilt each time.
  const sheet = useMemo(() => buildApprovalSheet(before, after), [before, after]);

  return (
    <div className="approval-sheet" data-testid="approval-sheet"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="approval-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="approval-sheet__toolbar">
          <button type="button" className="files__button is-primary" data-testid="approval-sheet-print"
            onClick={() => window.print()} disabled={!sheet.ok}>
            Печать / Сохранить как PDF
          </button>
          <button type="button" className="files__button" data-testid="approval-sheet-close" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {!sheet.ok ? (
          <p className="files__error" role="alert">
            Лист не собран: {sheet.issues.map((issue) => issue.message).join(' ')}
          </p>
        ) : (
          <article className="approval-sheet__page">
            <header className="approval-sheet__stamp">
              <h2 id={titleId} className="approval-sheet__title">Лист согласования перепланировки</h2>
              <dl className="approval-sheet__facts">
                <div><dt>Отделение / план</dt><dd data-testid="approval-sheet-plan-name">{after.name}</dd></div>
                <div><dt>Источник «до»</dt><dd data-testid="approval-sheet-before-source">{beforeSource}</dd></div>
                <div><dt>Дата</dt><dd>{today()}</dd></div>
                <div>
                  <dt><label htmlFor={`${titleId}-author`}>Автор</label></dt>
                  <dd>
                    <input id={`${titleId}-author`} type="text" data-testid="approval-sheet-author"
                      value={author} onChange={(event) => setAuthor(event.target.value)}
                      placeholder="ФИО и должность" />
                  </dd>
                </div>
              </dl>
            </header>

            <div className="approval-sheet__images">
              <figure>
                <figcaption>До</figcaption>
                {/* Our own SVG generator (persistence/plan-svg), not user input. */}
                <div data-testid="approval-sheet-before" dangerouslySetInnerHTML={{ __html: sheet.value.beforeSvg }} />
              </figure>
              <figure>
                <figcaption>После</figcaption>
                <div data-testid="approval-sheet-after" dangerouslySetInnerHTML={{ __html: sheet.value.afterSvg }} />
              </figure>
            </div>

            {sheet.value.comparison.warning === null ? null : (
              <p className="assistant__stale" role="status">{sheet.value.comparison.warning}</p>
            )}

            <h3>Эффект «было → стало»</h3>
            <table className="approval-sheet__table">
              <caption className="sr-only">Показатели было и стало</caption>
              <thead><tr><th scope="col">Показатель</th><th scope="col">Было</th><th scope="col">Стало</th><th scope="col">Разница</th></tr></thead>
              <tbody>
                {sheet.value.comparison.rows.map((row) => {
                  const digits = row.unit === 'count' ? 0 : 2;
                  return (
                    <tr key={row.metric} data-testid={`approval-sheet-metric-${row.metric}`}>
                      <th scope="row">{METRIC_LABELS[row.metric]}</th>
                      <td>{formatNumber(row.before, digits)}</td>
                      <td>{formatNumber(row.after, digits)}</td>
                      <td>{row.delta > 0 ? '+' : ''}{formatNumber(row.delta, digits)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3>Изменения в плане</h3>
            {sheet.value.comparison.changes === null ? (
              <p className="panel__empty">Сопоставление предметов не подтверждено: у файлов разные ID планов.</p>
            ) : sheet.value.comparison.changes.length === 0 ? (
              <p className="panel__empty">В плане изменений нет.</p>
            ) : (
              <ul className="approval-sheet__changes" data-testid="approval-sheet-changes">
                {sheet.value.comparison.changes.map((change) => (
                  <li key={`${change.ref.kind}-${change.ref.id}-${change.kind}`}>
                    <strong>{CHANGE_LABELS[change.kind]}: </strong>
                    {change.kind === 'removed' ? (change.beforeName ?? change.ref.id) : (change.afterName ?? change.ref.id)}
                    <span className="approval-sheet__id"> ({change.ref.id})</span>
                  </li>
                ))}
              </ul>
            )}

            {(sheet.value.assumptions.length === 0 && sheet.value.limitations.length === 0) ? null : (
              <>
                <h3>Использованные правила и допущения</h3>
                <ul className="approval-sheet__assumptions" data-testid="approval-sheet-assumptions">
                  {sheet.value.assumptions.map((line) => <li key={line}>{line}</li>)}
                  {sheet.value.limitations.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <p className="approval-sheet__rule-note">{RULE_NOTE}</p>
              </>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
