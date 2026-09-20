/**
 * M02 (metrics): areas of the branch and of its zones.
 *
 * Not a single formula lives here — `measurePlan` has already done the
 * arithmetic, including the union of footprints. When the geometry cannot be
 * measured the panel says so and names the broken outline instead of printing
 * a number that would then travel into the assistant's explanation.
 */

import type { Issue, Metrics, PlanDocument, Result } from '../../contracts/model';
import type { FocusSink } from '../../contracts/ui';
import { formatArea, formatNumber } from '../../domain/number-format';
import { useResizableColumns } from './resizable-columns';

export type MetricsPanelProps = {
  document: PlanDocument;
  metrics: Result<Metrics>;
  onFocus: FocusSink;
};

/**
 * Areas are shown to a hundredth, with a decimal comma and a glued unit. In the
 * zone table the unit is said once, in the caption: a 316 px panel wrapped
 * «63.00 м²» onto two lines and made the columns jump.
 */
const m2 = formatArea;

function firstBroken(issues: Issue[]): Issue | undefined {
  return issues[0];
}

export function MetricsPanel({
  document: plan,
  metrics,
  onFocus,
}: MetricsPanelProps): React.JSX.Element {
  const columns = useResizableColumns('metrics-zones', [46, 18, 18, 18]);
  if (!metrics.ok) {
    const issue = firstBroken(metrics.issues);
    return (
      <section className="panel" aria-label="Площади">
        <h2 className="panel__title">Площади</h2>
        <p className="files__error" role="alert">
          {issue?.message ?? 'Площади не рассчитаны.'}
        </p>
      </section>
    );
  }

  const { room, zones } = metrics.value;
  const named = plan.zones.map((zone) => ({ zone, area: zones[zone.id] }));

  return (
    <section className="panel" aria-label="Площади">
      <h2 className="panel__title">Площади</h2>

      <dl className="metrics">
        <div>
          <dt>Помещение</dt>
          <dd>{m2(room.total_m2)}</dd>
        </div>
        <div>
          <dt>Занято</dt>
          <dd>{m2(room.occupied_m2)}</dd>
        </div>
        <div>
          <dt>Свободно</dt>
          <dd data-testid="room-free">{m2(room.free_m2)}</dd>
        </div>
      </dl>

      {named.length === 0 ? (
        <p className="panel__empty">Зоны ещё не размечены</p>
      ) : (
        <table className="table metrics__table" style={{ tableLayout: 'fixed' }}>
          <caption className="metrics__caption">Площади зон, м²</caption>
          <colgroup>
            {columns.widths.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="table__resizable-head">
                Зона
                {columns.separator(0, 'Изменить ширину между «Зона» и «Всего»')}
              </th>
              <th scope="col" className="metrics__num table__resizable-head">
                Всего
                {columns.separator(1, 'Изменить ширину между «Всего» и «Занято»')}
              </th>
              <th scope="col" className="metrics__num table__resizable-head">
                Занято
                {columns.separator(2, 'Изменить ширину между «Занято» и «Свободно»')}
              </th>
              <th scope="col" className="metrics__num">Свободно</th>
            </tr>
          </thead>
          <tbody>
            {named.map(({ zone, area }) => (
              <tr key={zone.id}>
                <td>
                  <button
                    type="button"
                    className="table__link"
                    onClick={() => onFocus({ kind: 'zone', id: zone.id })}
                  >
                    {zone.name}
                  </button>
                </td>
                <td className="metrics__num">{area === undefined ? '—' : formatNumber(area.total_m2)}</td>
                <td className="metrics__num">{area === undefined ? '—' : formatNumber(area.occupied_m2)}</td>
                <td className="metrics__num">{area === undefined ? '—' : formatNumber(area.free_m2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="panel__note">
        Площади зон складывать нельзя: вложенная зона входит в площадь родителя. Занятый пол —
        объединение отпечатков, поэтому пересечение объектов не вычитается дважды.
      </p>
    </section>
  );
}
