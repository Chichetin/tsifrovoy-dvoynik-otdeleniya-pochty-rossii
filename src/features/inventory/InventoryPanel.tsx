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
 * tab (D-160). Catalog attributes are columns too: the person picks which,
 * and the file carries exactly the columns on screen.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { Id, PlanDocument } from '../../contracts/model';
import type { InventoryPanelProps, RequestState } from '../../contracts/ui';
import { EMPTY_INDEX, planIndex } from '../../domain/plan-index';
import { MAINTENANCE_DATE_KEY, MAINTENANCE_WARNING_DAYS, localToday } from '../../domain/validation';
import {
  attributeColumns,
  attributeText,
  type ColumnChoice,
  inventoryCsv,
  inventoryCsvFileName,
  loadColumnChoice,
  saveColumnChoice,
  visibleAttributeColumns,
} from '../../persistence/inventory-csv';
import {
  absentTypes,
  display,
  filterObjectRows,
  type InventorySort,
  maintenanceDue,
  NO_INVENTORY_NUMBER,
  objectRows,
  type SortColumn,
  sortObjectRows,
  typeSummary,
  typesWord,
  zoneSummary,
} from './rows';
import { useResizableColumns } from './resizable-columns';
import { orderZonesByNesting } from './zone-tree';

/**
 * The document is optional: until the composition passes it the panel keeps
 * working and shows ids, exactly as it did before names existed.
 */
export type InventoryPanelViewProps = InventoryPanelProps & { document?: PlanDocument };

/**
 * The summary lives in styles owned by another stream, so its two rules are
 * inline — the same way the library paints its colour swatch.
 */
const LIST_STYLE = { margin: '0 0 0.5rem', padding: 0, listStyle: 'none' } as const;

const CHIP_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.5rem',
  width: '100%',
  padding: '0.1875rem 0.375rem',
  // Longhand on purpose: React warns when a shorthand `border` and the
  // `borderColor` of the selected state replace each other between renders.
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: '0.3125rem',
  background: 'none',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

const CHIP_SELECTED_STYLE = { ...CHIP_STYLE, borderColor: 'var(--accent)', background: 'var(--ground)' };

/** Fixed columns: the widest name must not decide the width of the panel. */
const TABLE_STYLE = { tableLayout: 'fixed' } as const;

/**
 * The list scrolls inside the panel. Fifty-three objects made the table
 * 2866 px tall and pushed the areas, the zone breakdown and everything below
 * them off the screen (operator, finding 21); a thousand objects made the page
 * unusable. The height follows the font and the window — about six rows on a
 * 900 px screen — and the header stays put while the body scrolls.
 */
const SCROLL_STYLE = { maxHeight: 'min(60vh, 34em)', overflowY: 'auto', overflowX: 'auto' } as const;

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
  gap: '0.25rem',
  width: '100%',
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

const EXPORT_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' } as const;

/**
 * Both groups — types and the object list — start collapsed at the same
 * count: three rows are enough to recognise the panel is not empty without
 * the sixth-of-a-thousand-objects wall that a full table used to be. The
 * user's own request (22.09) names the number, not a screen-height guess.
 */
const COLLAPSE_LIMIT = 3;

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

/** Base widths of the four fixed columns, in percent of the table (D-213). */
const BASE_WIDTHS = [23, 26, 29, 22];

/**
 * An attribute column needs about this much room. With attribute columns the
 * table grows past the panel and the list scrolls sideways.
 */
const ATTRIBUTE_COLUMN_EM = 5.5;

/**
 * Default widths for the fixed columns plus `extra` attribute columns: every
 * attribute column gets an equal share, the fixed ones keep their proportions.
 */
function columnWidths(extra: number): number[] {
  if (extra === 0) return BASE_WIDTHS;
  const share = 100 / (BASE_WIDTHS.length + extra);
  const widths = [
    ...BASE_WIDTHS.map((width) => (width * BASE_WIDTHS.length * share) / 100),
    ...Array.from({ length: extra }, () => share),
  ].map((width) => Math.round(width * 100) / 100);
  const drift = 100 - widths.reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] = Math.round(((widths.at(-1) ?? 0) + drift) * 100) / 100;
  return widths;
}

const COLUMN_PICKER_STYLE = { margin: '0.25rem 0' } as const;
const FIELDSET_STYLE = { border: 'none', margin: 0, padding: 0 } as const;
const COLUMN_LIST_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(10em, 1fr))',
  gap: '0.125rem 0.5rem',
  margin: '0.25rem 0',
} as const;

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

export function InventoryPanel({
  inventory,
  document: plan,
  onFocus,
}: InventoryPanelViewProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<Id | null>(null);
  const [maintenanceOnly, setMaintenanceOnly] = useState(false);
  const [sort, setSort] = useState<InventorySort | null>(null);
  const [exported, setExported] = useState<RequestState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  // Свёрнуто по умолчанию — состояние экрана, а не документа: план и файл его
  // не хранят, и его же сбрасывает открытие другого файла ниже.
  const [typesExpanded, setTypesExpanded] = useState(false);
  const [rowsExpanded, setRowsExpanded] = useState(false);
  // Строка, по которой уже кликнули в этом перечне: сворачивание её не прячет,
  // иначе выбор на плане расходится с тем, что видно в списке (клик по
  // findings проверки на объект за пределами первых трёх работает так же
  // через холст — see README «известные ограничения»).
  const [pinnedRowId, setPinnedRowId] = useState<Id | null>(null);
  // Выбор столбцов атрибутов — вид этого человека, а не документа: живёт в
  // браузере и переживает открытие другого плана. Его же читает «Экспорт → CSV».
  const [choice, setChoice] = useState<ColumnChoice>(loadColumnChoice);
  const zoneColumns = useResizableColumns('inventory-zones', [50, 25, 25]);
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
    setMaintenanceOnly(false);
    setSort(null);
    setExported({ status: 'idle' });
    setNotice(null);
    setTypesExpanded(false);
    setRowsExpanded(false);
    setPinnedRowId(null);
  }
  // Тип, которого в плане больше нет, строкой сводки не снять: её уже нет на
  // экране. Такой фильтр снимается сам, иначе перечень остаётся пустым.
  if (typeId !== null && (inventory.byType[typeId] ?? 0) === 0) setTypeId(null);

  const naming = useMemo(() => (plan === undefined ? EMPTY_INDEX : planIndex(plan)), [plan]);
  const types = useMemo(() => typeSummary(inventory, naming), [inventory, naming]);
  const zones = useMemo(() => {
    const summary = zoneSummary(inventory, naming);
    const ordered = orderZonesByNesting(plan?.zones ?? []);
    const nesting = new Map(ordered.map(({ zone, depth }, index) => [zone.id, {
      depth,
      index,
      parentName: zone.parentId == null ? null : naming.zoneName(zone.parentId),
    }]));
    return summary.map((zone, index) => ({
      ...zone,
      depth: nesting.get(zone.zoneId)?.depth ?? 0,
      parentName: nesting.get(zone.zoneId)?.parentName ?? null,
      index: nesting.get(zone.zoneId)?.index ?? ordered.length + index,
    })).sort((a, b) => a.index - b.index);
  }, [inventory, naming, plan]);
  // Тот же день, что у проверки плана: фильтр и находки «ТО» не расходятся.
  const today = useMemo(() => localToday(), []);
  const rows = useMemo(() => objectRows(inventory, naming, today, plan?.catalog), [inventory, naming, today, plan?.catalog]);
  const found = useMemo(
    () => filterObjectRows(rows, { query: search, typeId, maintenanceDue: maintenanceOnly }),
    [rows, search, typeId, maintenanceOnly],
  );
  const dueCount = useMemo(() => rows.filter(maintenanceDue).length, [rows]);
  // Фильтр по ТО виден, когда справочник плана знает дату ТО хотя бы у одного типа.
  const tracksMaintenance = useMemo(
    () =>
      plan?.catalog.objectTypes.some((type) =>
        type.attributes.some((attribute) => attribute.key === MAINTENANCE_DATE_KEY),
      ) ?? false,
    [plan],
  );
  const shown = useMemo(() => sortObjectRows(found, sort), [found, sort]);

  const allAttributes = useMemo(
    () => (plan === undefined ? [] : attributeColumns(plan.catalog)),
    [plan],
  );
  // The whole plan shows no attribute column until one is picked: five columns
  // do not fit the right column, and a word is cut mid-way (#130). A filter by
  // one type still shows all attributes of that type.
  const attributes = useMemo(
    () =>
      plan === undefined
        ? []
        : visibleAttributeColumns(
            plan.catalog,
            typeId !== null ? [typeId] : types.map((type) => type.typeId),
            typeId !== null ? choice : { ...Object.fromEntries(allAttributes.map((column) => [column.key, false])), ...choice },
          ),
    [plan, typeId, types, choice, allAttributes],
  );
  const columns: { column: SortColumn; title: string }[] = [
    ...COLUMNS,
    ...attributes.map((attribute) => ({ column: `attr:${attribute.key}` as const, title: attribute.label })),
  ];
  const objectColumns = useResizableColumns(
    attributes.length === 0
      ? 'inventory-objects'
      : `inventory-objects:${attributes.map((attribute) => attribute.key).join(',')}`,
    columnWidths(attributes.length),
    Math.min(10, 40 / columns.length),
  );
  // Сортировка по скрытому столбцу не видна в шапке — такая снимается сама.
  if (sort !== null && !columns.some(({ column }) => column === sort.column)) setSort(null);

  const toggleAttribute = (key: string, shownNow: boolean): void => {
    const next = { ...choice, [key]: shownNow };
    setChoice(next);
    saveColumnChoice(next);
  };

  const defaultAttributes = (): void => {
    setChoice({});
    saveColumnChoice({});
  };

  const total = rows.length;
  const filtered = search.trim() !== '' || typeId !== null || maintenanceOnly;
  const absent = absentTypes(inventory);

  // Раскрыто целиком, когда просить нечего: сворачивать три строки незачем, а
  // активный поиск или фильтр по типу должен показать все совпадения — иначе
  // «нашёл, но не показал».
  const typesOverflow = types.length > COLLAPSE_LIMIT;
  const rowsOverflow = !filtered && shown.length > COLLAPSE_LIMIT;

  const reset = (): void => {
    setQuery('');
    setTypeId(null);
    setMaintenanceOnly(false);
  };

  const exportCsv = async (): Promise<void> => {
    setExported({ status: 'loading' });
    setNotice(null);
    // Кадр браузеру: на тысяче строк сборка файла заметна, и «готовим файл…»
    // должно успеть появиться до того, как страница замрёт.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const name = inventoryCsvFileName(plan);
    try {
      downloadCsv(inventoryCsv(shown, attributes), name);
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
        <div className="panel__group">
          <h3 className="panel__title">
            Объекты по типам <span className="panel__count">{types.length}</span>
          </h3>
          <ul style={LIST_STYLE} data-testid="inventory-types" id="inventory-types-list" title="Нажмите на тип, чтобы отфильтровать перечень">
            {types.map((type, index) => {
              const selected = type.typeId === typeId;
              const hidden = typesOverflow && !typesExpanded && index >= COLLAPSE_LIMIT;
              return (
                <li key={type.typeId} hidden={hidden}>
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
          {typesOverflow ? (
            <button
              type="button"
              className="table__link"
              aria-expanded={typesExpanded}
              aria-controls="inventory-types-list"
              data-testid="inventory-types-toggle"
              onClick={() => setTypesExpanded((value) => !value)}
            >
              {typesExpanded ? 'Свернуть' : `Показать все (${types.length})`}
            </button>
          ) : null}
          {absent === 0 ? null : (
            <p className="panel__note">
              Ещё {absent} {typesWord(absent)} справочника без объектов.
            </p>
          )}
        </div>
      )}

      {total === 0 ? (
        <p className="panel__empty">Оборудование ещё не размещено</p>
      ) : (
        <div className="panel__group">
          <h3 className="panel__title">
            Перечень объектов <span className="panel__count">{total}</span>
          </h3>
          <input
            type="search"
            className="panel__search"
            value={query}
            aria-label="Поиск по перечню"
            placeholder="Название, тип, зона, инвентарный номер"
            data-testid="inventory-search"
            onChange={(event) => setQuery(event.target.value)}
          />

          {tracksMaintenance ? (
            <label className="panel__note" style={{ ...COLUMN_PICKER_STYLE, display: 'block' }} data-testid="inventory-maintenance">
              <input
                type="checkbox"
                checked={maintenanceOnly}
                data-testid="inventory-maintenance-toggle"
                onChange={(event) => setMaintenanceOnly(event.target.checked)}
              />{' '}
              Только ТО просрочено или в ближайшие {MAINTENANCE_WARNING_DAYS} дн.: {dueCount}
            </label>
          ) : null}

          {allAttributes.length === 0 ? null : (
            <details style={COLUMN_PICKER_STYLE} data-testid="inventory-columns">
              <summary className="panel__note">
                Столбцы атрибутов: {attributes.length} из {allAttributes.length}
              </summary>
              <fieldset style={FIELDSET_STYLE}>
                <legend className="panel__note">
                  Без выбора видны атрибуты, общие для всех типов в перечне. Фильтр по типу
                  показывает все атрибуты типа. Те же столбцы уходят в CSV.
                </legend>
                <div style={COLUMN_LIST_STYLE}>
                  {allAttributes.map((attribute) => (
                    <label key={attribute.key} title={attribute.key}>
                      <input
                        type="checkbox"
                        data-testid="inventory-column-toggle"
                        data-key={attribute.key}
                        checked={attributes.some((shownColumn) => shownColumn.key === attribute.key)}
                        onChange={(event) => toggleAttribute(attribute.key, event.target.checked)}
                      />{' '}
                      {attribute.label}
                    </label>
                  ))}
                </div>
                {Object.keys(choice).length === 0 ? null : (
                  <button type="button" className="table__link" onClick={defaultAttributes}>
                    Вернуть столбцы по умолчанию
                  </button>
                )}
              </fieldset>
            </details>
          )}

          <div style={SCROLL_STYLE} data-testid="inventory-scroll" id="inventory-object-rows">
            <table
              className="table inventory__table"
              style={
                attributes.length === 0
                  ? TABLE_STYLE
                  : { ...TABLE_STYLE, width: `max(100%, ${columns.length * ATTRIBUTE_COLUMN_EM}em)` }
              }
            >
              <colgroup>
                {objectColumns.widths.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  {columns.map(({ column, title }, index) => (
                    <th
                      key={column}
                      scope="col"
                      style={STICKY_HEAD_STYLE}
                      aria-sort={ariaSort(sort, column)}
                      className="table__resizable-head"
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
                      {index === columns.length - 1 ? null : objectColumns.separator(
                        index,
                        `Изменить ширину между «${title}» и «${columns[index + 1]?.title ?? ''}»`,
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr
                    key={row.id}
                    hidden={
                      rowsOverflow &&
                      !rowsExpanded &&
                      index >= COLLAPSE_LIMIT &&
                      row.id !== pinnedRowId
                    }
                  >
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
                        onClick={() => {
                          onFocus({ kind: 'object', id: row.id });
                          // Строка, которую только что нашли, из перечня не
                          // прячется — даже когда «Свернуть» снова уберёт
                          // остальное за пределами первых трёх.
                          setPinnedRowId(row.id);
                        }}
                      >
                        {row.label}
                      </button>
                    </td>
                    <td title={row.typeLabel === null ? undefined : row.typeId}>
                      {display(row.typeLabel, row.typeId)}
                    </td>
                    <td>
                      {row.zoneId === null ? (
                        <span className="table__muted">вне зон</span>
                      ) : (
                        <button
                          type="button"
                          className="table__link"
                          title={row.zoneName === null ? undefined : row.zoneId}
                          onClick={() => onFocus({ kind: 'zone', id: row.zoneId as string })}
                        >
                          {display(row.zoneName, row.zoneId)}
                        </button>
                      )}
                    </td>
                    {attributes.map((attribute) => {
                      const text = attributeText(row.attributes[attribute.key]);
                      return (
                        <td key={attribute.key} data-testid="inventory-attr-cell" data-key={attribute.key}>
                          {text ?? <span className="table__muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rowsOverflow ? (
            <button
              type="button"
              className="table__link"
              aria-expanded={rowsExpanded}
              aria-controls="inventory-object-rows"
              data-testid="inventory-rows-toggle"
              onClick={() => setRowsExpanded((value) => !value)}
            >
              {rowsExpanded ? 'Свернуть' : `Показать все (${shown.length})`}
            </button>
          ) : null}

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
              {attributes.length === 0 ? '' : `, столбцов атрибутов ${attributes.length}`}
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
        </div>
      )}

      <div className="panel__group">
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
              {zoneColumns.widths.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="table__resizable-head">
                  Зона
                  {zoneColumns.separator(0, 'Изменить ширину между «Зона» и «В самой зоне»')}
                </th>
                <th scope="col" className="inventory__num table__resizable-head">
                  В самой зоне
                  {zoneColumns.separator(1, 'Изменить ширину между «В самой зоне» и «С вложенными»')}
                </th>
                <th scope="col" className="inventory__num">С вложенными</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.zoneId} data-depth={zone.depth}>
                  <td>
                    <button
                      type="button"
                      className="table__link"
                      title={zone.name === null ? undefined : zone.zoneId}
                      aria-label={zone.parentName === null ? undefined : `${display(zone.name, zone.zoneId)}, внутри зоны ${zone.parentName}`}
                      style={zone.depth === 0 ? undefined : { marginInlineStart: `${zone.depth * 12}px` }}
                      onClick={() => onFocus({ kind: 'zone', id: zone.zoneId })}
                    >
                      {zone.depth === 0 ? null : <span aria-hidden="true" className="metrics__nested">└ </span>}
                      {display(zone.name, zone.zoneId)}
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
      </div>
    </section>
  );
}
