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

export type MetricsPanelProps = {
  document: PlanDocument;
  metrics: Result<Metrics>;
  onFocus: FocusSink;
};

/** Areas are shown to a hundredth: the model is in metres, not in pixels. */
function m2(value: number): string {
  return `${value.toFixed(2)} м²`;
}

function firstBroken(issues: Issue[]): Issue | undefined {
  return issues[0];
}

export function MetricsPanel({
  document: plan,
  metrics,
  onFocus,
}: MetricsPanelProps): React.JSX.Element {
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
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Зона</th>
              <th scope="col">Всего</th>
              <th scope="col">Занято</th>
              <th scope="col">Свободно</th>
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
                <td>{area === undefined ? '—' : m2(area.total_m2)}</td>
                <td>{area === undefined ? '—' : m2(area.occupied_m2)}</td>
                <td>{area === undefined ? '—' : m2(area.free_m2)}</td>
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
