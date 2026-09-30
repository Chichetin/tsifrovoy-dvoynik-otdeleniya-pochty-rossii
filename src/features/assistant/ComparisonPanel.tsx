import { useId, useMemo, useRef } from 'react';
import type { PlanDocument, Ref } from '../../contracts/model';
import { buildPlanComparison, type ComparisonMetric } from '../../domain/plan-comparison';
import { formatNumber } from '../../domain/number-format';
import type { ComparisonSource } from './use-comparison-source';

const LABELS: Record<ComparisonMetric, string> = {
  'area.total': 'Площадь помещения, м²', 'area.occupied': 'Занято, м²',
  'area.free': 'Свободно, м²', 'equipment.count': 'Объектов',
  'issues.error': 'Ошибок', 'issues.warning': 'Предупреждений',
};
const CHANGES = { added: 'Добавлено', removed: 'Удалено', moved: 'Перемещено', updated: 'Обновлено' };

export function ComparisonPanel({ current, baseline, source, loading, error, onLoad, onClear, onFocus }: {
  current: PlanDocument;
  baseline: PlanDocument;
  source: ComparisonSource | null;
  loading: boolean;
  error: string | null;
  onLoad: (file: File) => Promise<void>;
  onClear: () => void;
  onFocus: (ref: Ref) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const report = useMemo(() => buildPlanComparison(source?.plan ?? baseline, current), [baseline, current, source]);
  return (
    <section className="comparison" aria-label="Сравнение планов">
      <p className="comparison__source">
        <strong>Было: </strong>{source === null ? 'состояние при открытии или сохранении' : `${source.fileName} — ${source.plan.name}`}
        <br /><strong>Стало: </strong>{current.name} — текущий план
      </p>
      <div className="comparison__actions">
        <button type="button" className="files__button" onClick={() => input.current?.click()}>
          {source === null ? 'Сравнить с файлом…' : 'Заменить исходный файл…'}
        </button>
        {source === null ? null : <button type="button" className="files__button" onClick={onClear}>Сбросить исходный файл</button>}
      </div>
      <label className="sr-only" htmlFor={id}>Исходный файл для сравнения</label>
      <input id={id} ref={input} className="sr-only" type="file" accept=".json,application/json" data-testid="comparison-file-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file !== undefined) void onLoad(file);
        }} />
      <p className="panel__empty">Исходный файл используется только для сравнения. Текущий план остаётся открытым.</p>
      {source === null ? null : <p className="panel__empty">Файл — база сценария «Эффект изменений». Чат выше сравнивает с последним открытием или сохранением.</p>}
      {loading ? <p role="status">Читаем исходный файл… Пока показана предыдущая база.</p> : null}
      {error === null ? null : <p className="files__error" role="alert">{error}</p>}
      {source === null ? null : [...source.assumptions, ...source.dropped.map((field) => `Поле не прочитано: ${field}`)].map((message, index) => <p key={index} className="panel__empty">{message}</p>)}
      {!report.ok ? <p className="files__error" role="alert">{report.issues.map((issue) => issue.message).join(' ')}</p> : <>
        {report.value.warning === null ? null : <p className="assistant__stale" role="status">{report.value.warning}</p>}
        <div className="comparison__table" tabIndex={0} role="region" aria-label="Показатели было и стало">
          <table>
            <caption>Расчёт по двум версиям плана</caption>
            <thead><tr><th scope="col">Показатель</th><th scope="col">Было</th><th scope="col">Стало</th><th scope="col">Разница</th></tr></thead>
            <tbody>{report.value.rows.map((row) => {
              const digits = row.unit === 'count' ? 0 : 2;
              return <tr key={row.metric} data-testid={`comparison-${row.metric}`}>
                <th scope="row">{LABELS[row.metric]}</th><td>{formatNumber(row.before, digits)}</td><td>{formatNumber(row.after, digits)}</td>
                <td>{row.delta > 0 ? '+' : ''}{formatNumber(row.delta, digits)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {report.value.changes === null ? null : <>
          <h3>Изменения в плане</h3>
          {report.value.changes.length === 0 ? <p className="panel__empty">В перечисленных элементах изменений нет.</p> : <ul className="comparison__changes">
            {report.value.changes.map((change) => <li key={`${change.ref.kind}-${change.ref.id}-${change.kind}`}>
              <strong>{CHANGES[change.kind]}: </strong>
              {change.kind === 'removed' ? (change.beforeName ?? change.ref.id) : <button type="button" className="comparison__focus" onClick={() => onFocus(change.ref)}>{change.afterName ?? change.ref.id}</button>}
              {change.beforeName !== null && change.afterName !== null && change.beforeName !== change.afterName ? <span> (раньше: {change.beforeName})</span> : null}
              <details><summary>ID</summary><code>{change.ref.id}</code></details>
            </li>)}
          </ul>}
          <p className="panel__empty">Список показывает предметы, зоны, слои и помещение. Изменения стен, проёмов и справочника сюда не входят. Числа пересчитываются при редактировании.</p>
        </>}
      </>}
    </section>
  );
}
