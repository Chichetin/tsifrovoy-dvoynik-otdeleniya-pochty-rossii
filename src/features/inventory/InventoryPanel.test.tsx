// @vitest-environment jsdom
/**
 * M02: что панель обещает специалисту по инвентаризации.
 *
 * Здесь проверяется связка, которой не видно в чистых функциях: сводка по
 * типам совпадает с числом строк, строка сводки фильтрует перечень, поиск
 * сужает его же, а сброс возвращает всё. Плюс главное для жюри: в таблице
 * стоит название типа и зоны, а `id` остаётся рядом, а не вместо названия.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { buildInventory } from '../../domain/inventory';
import { InventoryPanel } from './InventoryPanel';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const plan: PlanDocument = parsed.value;

function renderPanel() {
  const onFocus = vi.fn();
  const { rerender } = render(
    <InventoryPanel inventory={buildInventory(plan)} document={plan} onFocus={onFocus} />,
  );
  return { onFocus, rerender };
}

/** Панель без документа: композиция приложения ещё не передаёт его в пропсах. */
function renderWithoutDocument() {
  render(<InventoryPanel inventory={buildInventory(plan)} onFocus={vi.fn()} />);
}

/**
 * Пять типов и пять объектов — больше свёрнутого предела (3), чтобы
 * проверить и «Объекты по типам», и перечень одним планом. Три новых типа —
 * тестовые данные пакета, а не справочник продукта.
 */
function manyItemsPlan(): PlanDocument {
  const letters = ['c', 'd', 'e'] as const;
  const extraTypes = letters.map((letter) => ({
    id: `ot_${letter}`,
    label: `Тип ${letter.toUpperCase()}`,
    category: 'Тест',
    defaultSize_m: [0.5, 0.5] as [number, number],
    defaultHeight_m: 0.5,
    defaultBase_m: 0,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect' as const,
    color: '#000000',
    attributes: [],
    provenance: 'Тестовые данные пакета инвентаризации (сворачивание перечня).',
  }));
  const extraObjects = letters.map((letter, index) => ({
    id: `eq_${letter}`,
    typeId: `ot_${letter}`,
    label: `Объект ${letter.toUpperCase()}`,
    position: [3 + index, 3] as [number, number],
    size_m: [0.5, 0.5] as [number, number],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.5,
    zoneId: 'z_client',
    layerId: 'l_base',
    attributes: {},
  }));
  return {
    ...plan,
    catalog: { ...plan.catalog, objectTypes: [...plan.catalog.objectTypes, ...extraTypes] },
    objects: [...plan.objects, ...extraObjects],
  };
}

function renderMany() {
  const onFocus = vi.fn();
  const many = manyItemsPlan();
  render(<InventoryPanel inventory={buildInventory(many)} document={many} onFocus={onFocus} />);
  return { onFocus };
}

/** Строки перечня — первая таблица панели, как их видит браузерный сценарий. */
function objectRows(): HTMLElement[] {
  const tables = screen.getByLabelText('Инвентаризация').querySelectorAll('table');
  const body = tables[0]?.querySelector('tbody');
  return [...(body?.querySelectorAll('tr') ?? [])];
}

/** Строки, которые сейчас реально видны — без скрытых атрибутом `hidden`. */
function visibleRows(rows: HTMLElement[]): HTMLElement[] {
  return rows.filter((row) => !(row as HTMLTableRowElement).hidden);
}

function chips(): HTMLElement[] {
  return screen.getAllByTestId('inventory-type');
}

/** Чипы типов, которые сейчас видны, без скрытых `hidden`-атрибутом. */
function visibleChips(): HTMLElement[] {
  return chips().filter((chip) => !(chip.closest('li') as HTMLLIElement | null)?.hidden);
}

/** Текст ячеек строки перечня: «Инв. №», объект, тип, зона. */
function cells(row: HTMLElement): string[] {
  return [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '');
}

/** Заголовок колонки как кнопка сортировки. */
function sortBy(column: string): HTMLElement {
  const header = screen
    .getAllByTestId('inventory-sort')
    .find((button) => button.dataset['column'] === column);
  if (header === undefined) throw new Error(`нет колонки ${column}`);
  return header;
}

/**
 * Выгрузка отдаёт кадр браузеру перед сборкой файла, поэтому тест ждёт тот же
 * таймер, а не «какое-то время».
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Скачивание в jsdom: `URL.createObjectURL` там не реализован, а клик по
 * ссылке ничего не открывает. Подменяем оба и забираем то, что браузеру
 * действительно отдали, — содержимое файла и его имя.
 */
function stubDownload(): {
  text: () => Promise<string>;
  bytes: () => Promise<Uint8Array>;
  get name(): string;
} {
  let blob: Blob | null = null;
  let name = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation((given: Blob | MediaSource) => {
    blob = given as Blob;
    return 'blob:inventory';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    name = this.download;
  });
  const given = (): Blob => {
    if (blob === null) throw new Error('браузеру ничего не отдали');
    return blob;
  };
  return {
    // `Blob.text()` снимает BOM при декодировании, поэтому его проверяют по
    // байтам: в файле, который получит Excel, он есть.
    text: () => given().text(),
    bytes: async () => new Uint8Array(await given().arrayBuffer()),
    get name() {
      return name;
    },
  };
}

/** Первый элемент там, где его отсутствие — уже провал теста. */
function first<T>(items: T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error('ожидался хотя бы один элемент');
  return head;
}

describe('сводка по типам', () => {
  test('перечисляет размещённые типы с количеством', () => {
    renderPanel();

    expect(chips().map((chip) => chip.textContent)).toEqual([
      'Место ожидания1',
      'Рабочее место1',
    ]);
  });

  test('сумма по типам равна числу строк перечня', () => {
    renderPanel();
    const counts = screen
      .getAllByTestId('inventory-type-count')
      .map((cell) => Number(cell.textContent));

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(objectRows().length);
  });

  test('клик по строке сводки оставляет в перечне только этот тип, повторный — снимает', () => {
    renderPanel();
    const bench = first(chips());

    fireEvent.click(bench);
    expect(objectRows()).toHaveLength(1);
    expect(first(objectRows()).textContent).toContain('Скамья 1');
    expect(bench.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('inventory-shown').textContent).toBe('Показано 1 из 2');

    fireEvent.click(first(chips()));
    expect(objectRows()).toHaveLength(2);
    expect(screen.queryByTestId('inventory-shown')).toBeNull();
  });

  test('сводка не подменяет перечень: первая таблица панели — по-прежнему объекты', () => {
    renderPanel();

    expect(objectRows()).toHaveLength(2);
    expect(first(objectRows()).textContent).toContain('Рабочее место 1');
  });
});

describe('поиск', () => {
  test('оставляет только подходящие строки и сообщает, сколько показано', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'скамья' } });

    expect(objectRows()).toHaveLength(1);
    expect(first(objectRows()).textContent).toContain('Скамья 1');
    expect(screen.getByTestId('inventory-shown').textContent).toBe('Показано 1 из 2');
  });

  test('находит объект по инвентарному номеру из атрибутов', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'ОПС-0001' } });

    expect(objectRows()).toHaveLength(1);
    expect(first(objectRows()).textContent).toContain('Рабочее место 1');
  });

  test('ничего не найдено — пустой перечень и подсказка, а не молчание', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'банкомат' } });

    expect(objectRows()).toHaveLength(0);
    expect(screen.getByText(/Ничего не найдено/)).not.toBeNull();
    expect(screen.getByTestId('inventory-shown').textContent).toBe('Показано 0 из 2');
  });

  test('«Сбросить фильтр» возвращает весь перечень и снимает выбранный тип', () => {
    renderPanel();

    fireEvent.click(first(chips()));
    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'скамья' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));

    expect(objectRows()).toHaveLength(2);
    expect(first(chips()).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText<HTMLInputElement>('Поиск по перечню').value).toBe('');
  });
});

describe('названия вместо сырых id', () => {
  test('в строке стоит название типа и зоны, а id — рядом', () => {
    renderPanel();
    const row = within(first(objectRows()));

    expect(row.getByText('Рабочее место')).not.toBeNull();
    expect(row.getByText('ot_workplace')).not.toBeNull();
    expect(row.getByRole('button', { name: /Клиентская зона/ })).not.toBeNull();
    expect(row.getByText('z_client')).not.toBeNull();
  });

  test('клик по зоне в строке ведёт к самой зоне, а не к объекту', () => {
    const { onFocus } = renderPanel();

    fireEvent.click(
      within(first(objectRows())).getByRole('button', { name: /Клиентская зона/ }),
    );

    expect(onFocus).toHaveBeenCalledWith({ kind: 'zone', id: 'z_client' });
  });

  test('сводка по зонам названа именами зон плана', () => {
    renderPanel();
    const tables = [...screen.getByLabelText('Инвентаризация').querySelectorAll('table')];
    const zones = within(first(tables.slice(1)));

    expect(zones.getByRole('button', { name: /Клиентская зона/ })).not.toBeNull();
    expect(zones.getByRole('button', { name: /Зона ожидания/ })).not.toBeNull();
  });

  test('без документа панель работает и показывает id: пустых ячеек не появляется', () => {
    renderWithoutDocument();
    const row = within(first(objectRows()));

    expect(row.getByText('ot_workplace')).not.toBeNull();
    expect(row.getByRole('button', { name: 'z_client' })).not.toBeNull();
    expect(chips().map((chip) => chip.textContent)).toEqual(['ot_bench1', 'ot_workplace1']);
  });
});

describe('инвентарный номер и сортировка', () => {
  test('колонка «Инв. №» стоит первой, а объект без номера подписан прочерком', () => {
    renderPanel();
    const head = [...screen.getAllByTestId('inventory-sort')].map((cell) => cell.textContent);

    expect(head).toEqual(['Инв. №', 'Объект', 'Тип', 'Зона']);
    expect(cells(first(objectRows()))[0]).toBe('ОПС-0001');
    expect(cells(objectRows()[1] as HTMLElement)[0]).toBe('—');
  });

  test('клик по заголовку сортирует, второй — переворачивает, третий — возвращает порядок плана', () => {
    renderPanel();
    const numbers = () => objectRows().map((row) => cells(row)[0]);
    const header = () => sortBy('inventoryNumber').closest('th') as HTMLElement;

    expect(numbers()).toEqual(['ОПС-0001', '—']);
    expect(header().getAttribute('aria-sort')).toBe('none');

    fireEvent.click(sortBy('inventoryNumber'));
    // По возрастанию: номер есть — первый, «нет номера» всегда в конце.
    expect(numbers()).toEqual(['ОПС-0001', '—']);
    expect(header().getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(sortBy('inventoryNumber'));
    expect(header().getAttribute('aria-sort')).toBe('descending');
    expect(numbers()).toEqual(['ОПС-0001', '—']);

    fireEvent.click(sortBy('inventoryNumber'));
    expect(header().getAttribute('aria-sort')).toBe('none');
  });

  test('сортировка по названию объекта переставляет строки', () => {
    renderPanel();
    const labels = () => objectRows().map((row) => cells(row)[1]);

    expect(labels()).toEqual(['Рабочее место 1', 'Скамья 1']);

    fireEvent.click(sortBy('label'));
    expect(labels()).toEqual(['Рабочее место 1', 'Скамья 1']);

    fireEvent.click(sortBy('label'));
    expect(labels()).toEqual(['Скамья 1', 'Рабочее место 1']);

    // Порядок документа возвращается третьим кликом, а не перезагрузкой.
    fireEvent.click(sortBy('label'));
    expect(labels()).toEqual(['Рабочее место 1', 'Скамья 1']);
  });

  test('сортировка не мешает фильтру: сортируется то, что осталось', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'скамья' } });
    fireEvent.click(sortBy('label'));

    expect(objectRows()).toHaveLength(1);
    expect(screen.getByTestId('inventory-shown').textContent).toBe('Показано 1 из 2');
  });
});

describe('перечень прокручивается внутри панели', () => {
  test('таблица объектов лежит в контейнере с ограниченной высотой и прокруткой', () => {
    renderPanel();
    const scroll = screen.getByTestId('inventory-scroll');

    expect(scroll.querySelector('table')).not.toBeNull();
    expect(scroll.style.maxHeight).not.toBe('');
    expect(scroll.style.overflowY).toBe('auto');
    // Шапка закреплена: при прокрутке 53 строк видно, какая колонка какая.
    for (const head of scroll.querySelectorAll('thead th')) {
      expect((head as HTMLElement).style.position).toBe('sticky');
    }
  });

  test('числа разреза по зонам — в числовых колонках, выровненных по правому краю', () => {
    renderPanel();
    const tables = screen.getByLabelText('Инвентаризация').querySelectorAll('table');
    const zones = tables[1];
    if (zones === undefined) throw new Error('нет таблицы по зонам');
    const heads = [...zones.querySelectorAll('thead th')];
    expect(heads.slice(1).every((head) => head.className.includes('inventory__num'))).toBe(true);
    for (const row of zones.querySelectorAll('tbody tr')) {
      const cells = [...row.querySelectorAll('td')].slice(1);
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell.className).toContain('inventory__num');
        expect(cell.textContent).toMatch(/^\d+$/);
      }
    }
    for (const count of screen.getAllByTestId('inventory-type-count')) {
      expect(count.className).toContain('inventory__num');
    }
  });
});

describe('смена документа', () => {
  /** Другой план: тот же справочник, другой `id` — как другой открытый файл. */
  const other: PlanDocument = { ...plan, id: 'plan_other' };

  test('открыли другой план — фильтр и поиск сброшены, перечень виден целиком', () => {
    const { rerender } = renderPanel();

    fireEvent.click(first(chips()));
    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'скамья' } });
    fireEvent.click(sortBy('label'));
    expect(objectRows()).toHaveLength(1);

    rerender(
      <InventoryPanel inventory={buildInventory(other)} document={other} onFocus={vi.fn()} />,
    );

    expect(objectRows()).toHaveLength(2);
    expect(screen.getByLabelText<HTMLInputElement>('Поиск по перечню').value).toBe('');
    expect(first(chips()).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('inventory-shown')).toBeNull();
    expect(
      (sortBy('label').closest('th') as HTMLElement).getAttribute('aria-sort'),
    ).toBe('none');
  });

  test('правка того же плана фильтр сохраняет: это не другой файл', () => {
    const { rerender } = renderPanel();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'скамья' } });
    // Новый объект документа с тем же `id` — так выглядит любая правка в 2D.
    const edited: PlanDocument = { ...plan, name: `${plan.name} (правка)` };
    rerender(
      <InventoryPanel inventory={buildInventory(edited)} document={edited} onFocus={vi.fn()} />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Поиск по перечню').value).toBe('скамья');
    expect(objectRows()).toHaveLength(1);
  });

  test('тип, которого в плане не осталось, перестаёт фильтровать перечень', () => {
    const { rerender } = renderPanel();

    fireEvent.click(first(chips()));
    expect(objectRows()).toHaveLength(1);

    // Скамью удалили: строки сводки для неё больше нет, снять фильтр нечем.
    const without: PlanDocument = {
      ...plan,
      objects: plan.objects.filter((object) => object.typeId !== 'ot_bench'),
    };
    rerender(
      <InventoryPanel inventory={buildInventory(without)} document={without} onFocus={vi.fn()} />,
    );

    expect(objectRows()).toHaveLength(1);
    expect(cells(first(objectRows()))[1]).toBe('Рабочее место 1');
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false']);
  });
});

describe('выгрузка CSV', () => {
  test('скачивается файл с BOM, шапкой и строками перечня; шаги видны на экране', async () => {
    const download = stubDownload();
    renderPanel();

    expect(screen.getByTestId('inventory-csv-scope').textContent).toBe(
      'выгрузится весь перечень: строк 2',
    );

    fireEvent.click(screen.getByTestId('inventory-csv'));
    // Состояние загрузки — до того, как файл собран.
    expect(screen.getByTestId('inventory-csv-loading')).not.toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('inventory-csv').disabled).toBe(true);

    await settle();

    // Первые три байта — UTF-8 BOM: без него Excel читает файл как cp1251.
    expect([...(await download.bytes()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await download.text();
    expect(text.split('\r\n')).toHaveLength(3);
    expect(text).toContain('ОПС-0001;Рабочее место 1;eq_work_1');
    expect(download.name).toBe('Вложенные-зоны-инвентаризация.csv');

    expect(screen.queryByTestId('inventory-csv-loading')).toBeNull();
    expect(screen.getByTestId('inventory-csv-done').textContent).toContain('строк 2');
    expect(screen.queryByTestId('inventory-csv-error')).toBeNull();
  });

  test('выгружается отфильтрованное, и об этом сказано до клика', async () => {
    const download = stubDownload();
    renderPanel();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'скамья' } });
    expect(screen.getByTestId('inventory-csv-scope').textContent).toBe(
      'выгрузится отфильтрованное: строк 1 из 2',
    );

    fireEvent.click(screen.getByTestId('inventory-csv'));
    await settle();

    const text = await download.text();
    expect(text.split('\r\n')).toHaveLength(2);
    expect(text).toContain('Скамья 1');
    expect(text).not.toContain('Рабочее место 1');
    expect(screen.getByTestId('inventory-csv-done').textContent).toContain('(по фильтру)');
  });

  test('выгружается в том порядке, в котором отсортирована таблица', async () => {
    const download = stubDownload();
    renderPanel();

    fireEvent.click(sortBy('label'));
    fireEvent.click(sortBy('label'));
    fireEvent.click(screen.getByTestId('inventory-csv'));
    await settle();

    const lines = (await download.text()).split('\r\n');
    expect(lines[1]).toContain('Скамья 1');
    expect(lines[2]).toContain('Рабочее место 1');
  });

  test('браузер не дал сохранить файл — видно ошибку, а не тихий успех', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('нет доступа к хранилищу');
    });
    renderPanel();

    fireEvent.click(screen.getByTestId('inventory-csv'));
    await settle();

    expect(screen.getByTestId('inventory-csv-error').textContent).toBe(
      'Перечень не выгружен: нет доступа к хранилищу',
    );
    expect(screen.queryByTestId('inventory-csv-done')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('inventory-csv').disabled).toBe(false);
  });
});

describe('сворачивание «Объекты по типам» и перечня', () => {
  test('по умолчанию видны первые три, дальше — кнопка с числом', () => {
    renderMany();

    expect(objectRows()).toHaveLength(5);
    expect(visibleRows(objectRows())).toHaveLength(3);
    expect(chips()).toHaveLength(5);
    expect(visibleChips()).toHaveLength(3);

    const rowsToggle = screen.getByTestId('inventory-rows-toggle');
    expect(rowsToggle.textContent).toBe('Показать все (5)');
    expect(rowsToggle.getAttribute('aria-expanded')).toBe('false');

    const typesToggle = screen.getByTestId('inventory-types-toggle');
    expect(typesToggle.textContent).toBe('Показать все (5)');
    expect(typesToggle.getAttribute('aria-expanded')).toBe('false');
  });

  test('«Показать все» раскрывает список, «Свернуть» возвращает обратно', () => {
    renderMany();

    fireEvent.click(screen.getByTestId('inventory-rows-toggle'));
    expect(visibleRows(objectRows())).toHaveLength(5);
    expect(screen.getByTestId('inventory-rows-toggle').textContent).toBe('Свернуть');
    expect(screen.getByTestId('inventory-rows-toggle').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('inventory-rows-toggle'));
    expect(visibleRows(objectRows())).toHaveLength(3);

    fireEvent.click(screen.getByTestId('inventory-types-toggle'));
    expect(visibleChips()).toHaveLength(5);
    fireEvent.click(screen.getByTestId('inventory-types-toggle'));
    expect(visibleChips()).toHaveLength(3);
  });

  test('элементов не больше трёх — кнопки «Показать все» нет', () => {
    renderPanel();

    expect(objectRows()).toHaveLength(2);
    expect(screen.queryByTestId('inventory-rows-toggle')).toBeNull();
    expect(chips()).toHaveLength(2);
    expect(screen.queryByTestId('inventory-types-toggle')).toBeNull();
  });

  test('активный поиск показывает все совпадения без кнопки — не «нашёл, но не показал»', () => {
    renderMany();

    fireEvent.change(screen.getByLabelText('Поиск по перечню'), { target: { value: 'z_client' } });

    // eq_work_1 и три добавленных объекта (C, D, E) лежат в z_client — четыре
    // строки, больше предела в три, и все они видны сразу.
    expect(visibleRows(objectRows())).toHaveLength(4);
    expect(screen.queryByTestId('inventory-rows-toggle')).toBeNull();
  });

  test('строка сводки по типам фильтрует перечень целиком, без кнопки', () => {
    renderMany();

    // Тип за пределами первых трёх типов доступен через раскрытие типов…
    fireEvent.click(screen.getByTestId('inventory-types-toggle'));
    const chipE = chips().find((chip) => chip.getAttribute('data-type-id') === 'ot_e');
    if (chipE === undefined) throw new Error('чип типа ot_e не найден');
    fireEvent.click(chipE);

    // …и с этого момента перечень фильтром показывает единственный объект
    // этого типа без кнопки «Показать все» — фильтр важнее лимита.
    expect(visibleRows(objectRows())).toHaveLength(1);
    expect(screen.queryByTestId('inventory-rows-toggle')).toBeNull();
  });

  test('строка, по которой кликнули, остаётся видимой и после повторного «Свернуть»', () => {
    const { onFocus } = renderMany();

    fireEvent.click(screen.getByTestId('inventory-rows-toggle'));
    const rowE = within(objectRows()[4] as HTMLElement);
    fireEvent.click(rowE.getByRole('button', { name: 'Объект E' }));
    expect(onFocus).toHaveBeenCalledWith({ kind: 'object', id: 'eq_e' });

    fireEvent.click(screen.getByTestId('inventory-rows-toggle'));
    expect(screen.getByTestId('inventory-rows-toggle').textContent).toBe('Показать все (5)');

    const rows = objectRows();
    // Первые три плюс объект E — то, по которому только что кликнули; D
    // между ними по-прежнему скрыт — сворачивание не подряд, а по id.
    expect(visibleRows(rows)).toHaveLength(4);
    expect((rows[4] as HTMLTableRowElement).hidden).toBe(false);
    expect((rows[3] as HTMLTableRowElement).hidden).toBe(true);
  });
});
