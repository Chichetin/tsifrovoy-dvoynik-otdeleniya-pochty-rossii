/**
 * M02: the inventory table.
 *
 * No arithmetic in this file. Everything shown is already counted by
 * `buildInventory`, so the table cannot disagree with the plan — and the
 * inclusive column is labelled as "with nested zones" precisely because those
 * numbers must not be added up.
 */

import type { InventoryPanelProps } from '../../contracts/ui';

export function InventoryPanel({ inventory, onFocus }: InventoryPanelProps): React.JSX.Element {
  const total = inventory.rows.length;

  return (
    <section className="panel" aria-label="Инвентаризация">
      <h2 className="panel__title">
        Инвентаризация <span className="panel__count">{total}</span>
      </h2>

      {total === 0 ? (
        <p className="panel__empty">Оборудование ещё не размещено</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Объект</th>
              <th scope="col">Тип</th>
              <th scope="col">Зона</th>
            </tr>
          </thead>
          <tbody>
            {inventory.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <button
                    type="button"
                    className="table__link"
                    onClick={() => onFocus({ kind: 'object', id: row.id })}
                  >
                    {row.label}
                  </button>
                </td>
                <td>{row.typeId}</td>
                <td>
                  {row.zoneId === null ? (
                    <span className="table__muted">вне зон</span>
                  ) : (
                    <button
                      type="button"
                      className="table__link"
                      onClick={() => onFocus({ kind: 'zone', id: row.zoneId as string })}
                    >
                      {row.zoneId}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="metrics">
        <div>
          <dt>Всего объектов</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>Вне зон</dt>
          <dd>{inventory.unassigned}</dd>
        </div>
      </dl>

      {Object.keys(inventory.byZoneDirect).length === 0 ? null : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Зона</th>
              <th scope="col">В самой зоне</th>
              <th scope="col">С вложенными</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(inventory.byZoneDirect).map(([zoneId, direct]) => (
              <tr key={zoneId}>
                <td>
                  <button
                    type="button"
                    className="table__link"
                    onClick={() => onFocus({ kind: 'zone', id: zoneId })}
                  >
                    {zoneId}
                  </button>
                </td>
                <td>{direct}</td>
                <td>{inventory.byZoneInclusive[zoneId] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="panel__note">
        Столбец «с вложенными» суммировать нельзя: объект вложенной зоны учтён и у родителя.
      </p>
    </section>
  );
}
