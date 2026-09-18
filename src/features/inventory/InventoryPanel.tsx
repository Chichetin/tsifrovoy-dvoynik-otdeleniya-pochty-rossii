/**
 * M02: the inventory table — what stands in the branch, by type and by zone.
 *
 * No arithmetic in this file. Everything shown is already counted by
 * `buildInventory` and only grouped and named by `./rows`, so the table cannot
 * disagree with the plan — and the inclusive column is labelled "with nested
 * zones" precisely because those numbers must not be added up.
 *
 * Names come from the document that is open: type labels from its catalog,
 * zone names from its zones. The raw id stays next to the name in smaller
 * type, because the card, the checks and the assistant all speak ids and the
 * jury has to be able to match one to the other.
 *
 * The panel is also the fastest way to find a single item among a thousand,
 * so it carries a search line and a by-type summary whose line filters the
 * table. Neither of them touches the document: a filter hides rows, it never
 * deletes anything.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { Id, PlanDocument } from '../../contracts/model';
import type { InventoryPanelProps } from '../../contracts/ui';
import {
  absentTypes,
  display,
  filterObjectRows,
  namingOf,
  objectRows,
  typeSummary,
  typesWord,
  zoneSummary,
} from './rows';

/**
 * The document is optional: until the composition passes it the panel keeps
 * working and shows ids, exactly as it did before names existed.
 */
export type InventoryPanelViewProps = InventoryPanelProps & { document?: PlanDocument };

/**
 * The summary lives in styles owned by another stream, so its two rules are
 * inline — the same way the library paints its colour swatch.
 */
const LIST_STYLE = { margin: '0 0 8px', padding: 0, listStyle: 'none' } as const;

const CHIP_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '8px',
  width: '100%',
  padding: '3px 6px',
  // Longhand on purpose: React warns when a shorthand `border` and the
  // `borderColor` of the selected state replace each other between renders.
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: '5px',
  background: 'none',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

const CHIP_SELECTED_STYLE = { ...CHIP_STYLE, borderColor: 'var(--accent)', background: '#f8f9fa' };

/**
 * The id goes under the name, not after it: the side panel is 315 px wide and
 * a name plus an id on one line pushed the table 138 px past its edge.
 * `anywhere` lets `ot_fire_sensor` break instead of widening the column.
 */
const ID_STYLE = { display: 'block', fontSize: '11px', overflowWrap: 'anywhere' } as const;

/** Fixed columns: the widest name must not decide the width of the panel. */
const TABLE_STYLE = { tableLayout: 'fixed' } as const;

/** The raw id after the name: secondary, but never hidden. */
function RawId({ id }: { id: Id }): React.JSX.Element {
  return (
    <span className="table__muted" style={ID_STYLE}>
      {id}
    </span>
  );
}

export function InventoryPanel({
  inventory,
  document: plan,
  onFocus,
}: InventoryPanelViewProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<Id | null>(null);
  // Typing and clearing stay responsive on a thousand rows: the table redraws
  // one render behind the input instead of blocking every keystroke. Measured
  // (D-123): clearing the filter on 1000 objects is 728 ms against 2051 ms.
  const search = useDeferredValue(query);

  const naming = useMemo(() => namingOf(plan), [plan]);
  const types = useMemo(() => typeSummary(inventory, naming), [inventory, naming]);
  const zones = useMemo(() => zoneSummary(inventory, naming), [inventory, naming]);
  const rows = useMemo(() => objectRows(inventory, naming), [inventory, naming]);
  const shown = useMemo(
    () => filterObjectRows(rows, { query: search, typeId }),
    [rows, search, typeId],
  );

  const total = rows.length;
  const filtered = search.trim() !== '' || typeId !== null;
  const absent = absentTypes(inventory);

  const reset = (): void => {
    setQuery('');
    setTypeId(null);
  };

  return (
    <section className="panel" aria-label="Инвентаризация">
      <h2 className="panel__title">
        Инвентаризация <span className="panel__count">{total}</span>
      </h2>

      {types.length === 0 ? null : (
        <>
          <h3 className="panel__title">
            Объекты по типам <span className="panel__count">{types.length}</span>
          </h3>
          <ul style={LIST_STYLE} data-testid="inventory-types">
            {types.map((type) => {
              const selected = type.typeId === typeId;
              return (
                <li key={type.typeId}>
                  <button
                    type="button"
                    style={selected ? CHIP_SELECTED_STYLE : CHIP_STYLE}
                    aria-pressed={selected}
                    data-testid="inventory-type"
                    data-type-id={type.typeId}
                    title={type.typeId}
                    onClick={() => setTypeId(selected ? null : type.typeId)}
                  >
                    <span>{display(type.label, type.typeId)}</span>
                    <span data-testid="inventory-type-count">{type.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="panel__note">
            {absent === 0
              ? 'Показаны типы справочника, у которых есть объекты. Строка типа фильтрует перечень.'
              : `Строка типа фильтрует перечень. Ещё ${absent} ${typesWord(absent)} справочника без объектов.`}
          </p>
        </>
      )}

      {total === 0 ? (
        <p className="panel__empty">Оборудование ещё не размещено</p>
      ) : (
        <>
          <input
            type="search"
            className="panel__search"
            value={query}
            aria-label="Поиск по перечню"
            placeholder="Название, тип, зона, инвентарный номер"
            data-testid="inventory-search"
            onChange={(event) => setQuery(event.target.value)}
          />

          <table className="table" style={TABLE_STYLE}>
            <colgroup>
              <col style={{ width: '38%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Объект</th>
                <th scope="col">Тип</th>
                <th scope="col">Зона</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="table__link"
                      title={row.id}
                      onClick={() => onFocus({ kind: 'object', id: row.id })}
                    >
                      {row.label}
                    </button>
                  </td>
                  <td>
                    {display(row.typeLabel, row.typeId)}
                    {row.typeLabel === null ? null : <RawId id={row.typeId} />}
                  </td>
                  <td>
                    {row.zoneId === null ? (
                      <span className="table__muted">вне зон</span>
                    ) : (
                      <button
                        type="button"
                        className="table__link"
                        onClick={() => onFocus({ kind: 'zone', id: row.zoneId as string })}
                      >
                        {display(row.zoneName, row.zoneId)}
                        {row.zoneName === null ? null : <RawId id={row.zoneId} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered ? (
            <p className="panel__note">
              <span data-testid="inventory-shown">
                Показано {shown.length} из {total}
              </span>{' '}
              <button type="button" className="table__link" onClick={reset}>
                Сбросить фильтр
              </button>
            </p>
          ) : null}

          {filtered && shown.length === 0 ? (
            <p className="panel__empty">Ничего не найдено — измените запрос или снимите фильтр</p>
          ) : null}
        </>
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

      {zones.length === 0 ? null : (
        <table className="table" style={TABLE_STYLE}>
          <colgroup>
            <col style={{ width: '50%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '25%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Зона</th>
              <th scope="col">В самой зоне</th>
              <th scope="col">С вложенными</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <tr key={zone.zoneId}>
                <td>
                  <button
                    type="button"
                    className="table__link"
                    onClick={() => onFocus({ kind: 'zone', id: zone.zoneId })}
                  >
                    {display(zone.name, zone.zoneId)}
                    {zone.name === null ? null : <RawId id={zone.zoneId} />}
                  </button>
                </td>
                <td>{zone.direct}</td>
                <td>{zone.inclusive}</td>
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
