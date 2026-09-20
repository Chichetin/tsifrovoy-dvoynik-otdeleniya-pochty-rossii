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
 * so it carries a search line, a by-type summary whose line filters the table,
 * an inventory number in a column of its own and sorting by any column.
 * Neither of them touches the document: a filter hides rows, it never deletes
 * anything.
 *
 * What is on screen can be taken away as a file: «Скачать CSV» writes exactly
 * the rows that are shown, in the order they are shown, and says so before the
 * click — an inventory check happens on paper and in Excel, not in a browser
 * tab (D-160).
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { Id, PlanDocument } from '../../contracts/model';
import type { InventoryPanelProps, RequestState } from '../../contracts/ui';
import { EMPTY_INDEX, planIndex } from '../../domain/plan-index';
import {
  absentTypes,
  display,
  filterObjectRows,
  inventoryCsv,
  type InventorySort,
  NO_INVENTORY_NUMBER,
  objectRows,
  type SortColumn,
  sortObjectRows,
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

const CHIP_SELECTED_STYLE = { ...CHIP_STYLE, borderColor: 'var(--accent)', background: 'var(--ground)' };

/**
 * The id goes under the name, not after it: the side panel is 315 px wide and
 * a name plus an id on one line pushed the table 138 px past its edge.
 * `anywhere` lets `ot_fire_sensor` break instead of widening the column.
 */
const ID_STYLE = { display: 'block', fontSize: '12px', overflowWrap: 'anywhere' } as const;

/** Fixed columns: the widest name must not decide the width of the panel. */
const TABLE_STYLE = { tableLayout: 'fixed' } as const;

/**
 * The list scrolls inside the panel. Fifty-three objects made the table
 * 2866 px tall and pushed the areas, the zone breakdown and everything below
 * them off the screen (operator, finding 21); a thousand objects made the page
 * unusable. The height follows the font and the window — about six rows on a
 * 900 px screen — and the header stays put while the body scrolls.
 */
const SCROLL_STYLE = { maxHeight: 'min(60vh, 34em)', overflowY: 'auto' } as const;

/**
 * `border-collapse` drops the border of a sticky cell, so the line under the
 * header is drawn by a shadow instead.
 */
const STICKY_HEAD_STYLE = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: 'var(--surface)',
  boxShadow: 'inset 0 -1px 0 var(--line)',
} as const;

const SORT_BUTTON_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '4px',
  width: '100%',
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

const EXPORT_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' } as const;

/** Columns that can be sorted, in the order of the table. */
const COLUMNS: { column: SortColumn; title: string }[] = [
  { column: 'inventoryNumber', title: 'Инв. №' },
  { column: 'label', title: 'Объект' },
  { column: 'type', title: 'Тип' },
  { column: 'zone', title: 'Зона' },
];

const ARROW = { asc: '↑', desc: '↓' } as const;

/**
 * Sorting cycles through three states, not two: the third click returns the
 * document order, which is the order of the plan file and of the 2D canvas,
 * and there is no other way back to it.
 */
function nextSort(current: InventorySort | null, column: SortColumn): InventorySort | null {
  if (current === null || current.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

function ariaSort(sort: InventorySort | null, column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (sort === null || sort.column !== column) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** `Демо-ОПС «Синтетическое»` → `Демо-ОПС-Синтетическое-инвентаризация.csv`. */
function csvFileName(plan: PlanDocument | undefined): string {
  const stem = (plan?.name ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
  return `${stem === '' ? 'plan' : stem}-инвентаризация.csv`;
}

/**
 * The browser is handed the file; what happens in the download folder a page
 * cannot know, so the notice claims no more than that — the same wording the
 * plan file itself uses when it is saved.
 */
function downloadCsv(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

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
  const [sort, setSort] = useState<InventorySort | null>(null);
  const [exported, setExported] = useState<RequestState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  // Typing and clearing stay responsive on a thousand rows: the table redraws
  // one render behind the input instead of blocking every keystroke. Measured
  // (D-123): clearing the filter on 1000 objects is 728 ms against 2051 ms.
  const search = useDeferredValue(query);

  // Опрокинуть фильтр при смене плана. Панель узнаёт о смене по `id`
  // документа: правка открытого плана даёт новый объект, но тот же `id`, и
  // фильтр переживает её — а другой файл начинается с чистого перечня, а не с
  // пустого экрана по слову, набранному для прошлого отделения (D-140).
  const [openedId, setOpenedId] = useState<Id | undefined>(plan?.id);
  if (plan?.id !== openedId) {
    setOpenedId(plan?.id);
    setQuery('');
    setTypeId(null);
    setSort(null);
    setExported({ status: 'idle' });
    setNotice(null);
  }
  // Тип, которого в плане больше нет, строкой сводки не снять: её уже нет на
  // экране. Такой фильтр снимается сам, иначе перечень остаётся пустым.
  if (typeId !== null && (inventory.byType[typeId] ?? 0) === 0) setTypeId(null);

  const naming = useMemo(() => (plan === undefined ? EMPTY_INDEX : planIndex(plan)), [plan]);
  const types = useMemo(() => typeSummary(inventory, naming), [inventory, naming]);
  const zones = useMemo(() => zoneSummary(inventory, naming), [inventory, naming]);
  const rows = useMemo(() => objectRows(inventory, naming), [inventory, naming]);
  const found = useMemo(
    () => filterObjectRows(rows, { query: search, typeId }),
    [rows, search, typeId],
  );
  const shown = useMemo(() => sortObjectRows(found, sort), [found, sort]);

  const total = rows.length;
  const filtered = search.trim() !== '' || typeId !== null;
  const absent = absentTypes(inventory);

  const reset = (): void => {
    setQuery('');
    setTypeId(null);
  };

  const exportCsv = async (): Promise<void> => {
    setExported({ status: 'loading' });
    setNotice(null);
    // Кадр браузеру: на тысяче строк сборка файла заметна, и «готовим файл…»
    // должно успеть появиться до того, как страница замрёт.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const name = csvFileName(plan);
    try {
      downloadCsv(inventoryCsv(shown), name);
    } catch (error) {
      setExported({
        status: 'error',
        message: `Перечень не выгружен: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    setNotice(
      `Файл ${name} передан браузеру: строк ${shown.length}${filtered ? ' (по фильтру)' : ''}.`,
    );
    setExported({ status: 'done' });
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
                    <span className="inventory__num" data-testid="inventory-type-count">
                      {type.count}
                    </span>
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

          <div style={SCROLL_STYLE} data-testid="inventory-scroll">
            <table className="table inventory__table" style={TABLE_STYLE}>
              <colgroup>
                <col style={{ width: '23%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '29%' }} />
                <col style={{ width: '22%' }} />
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map(({ column, title }) => (
                    <th
                      key={column}
                      scope="col"
                      style={STICKY_HEAD_STYLE}
                      aria-sort={ariaSort(sort, column)}
                    >
                      <button
                        type="button"
                        style={SORT_BUTTON_STYLE}
                        data-testid="inventory-sort"
                        data-column={column}
                        title={`Сортировать по «${title}»`}
                        onClick={() => setSort(nextSort(sort, column))}
                      >
                        <span>{title}</span>
                        <span aria-hidden="true">
                          {sort?.column === column ? ARROW[sort.direction] : ''}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.inventoryNumber === null ? (
                        <span className="table__muted" title="Инвентарный номер не задан">
                          {NO_INVENTORY_NUMBER}
                        </span>
                      ) : (
                        row.inventoryNumber
                      )}
                    </td>
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
          </div>

          <div style={EXPORT_ROW_STYLE}>
            <button
              type="button"
              className="files__button"
              data-testid="inventory-csv"
              disabled={exported.status === 'loading'}
              onClick={() => void exportCsv()}
            >
              Скачать CSV
            </button>
            <span className="panel__note" data-testid="inventory-csv-scope">
              {filtered
                ? `выгрузится отфильтрованное: строк ${shown.length} из ${total}`
                : `выгрузится весь перечень: строк ${total}`}
            </span>
          </div>

          {exported.status === 'loading' ? (
            <p className="panel__note" data-testid="inventory-csv-loading">
              готовим файл…
            </p>
          ) : null}

          {exported.status === 'done' && notice !== null ? (
            <p className="panel__note" data-testid="inventory-csv-done">
              {notice}
            </p>
          ) : null}

          {exported.status === 'error' ? (
            <p className="files__error" role="alert" data-testid="inventory-csv-error">
              {exported.message}
            </p>
          ) : null}

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
              <th scope="col" className="inventory__num">В самой зоне</th>
              <th scope="col" className="inventory__num">С вложенными</th>
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
                <td className="inventory__num">{zone.direct}</td>
                <td className="inventory__num">{zone.inclusive}</td>
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
