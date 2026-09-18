/**
 * M02: что панель обещает специалисту по инвентаризации.
 *
 * Здесь проверяется связка, которой не видно в чистых функциях: сводка по
 * типам совпадает с числом строк, строка сводки фильтрует перечень, поиск
 * сужает его же, а сброс возвращает всё. Плюс главное для жюри: в таблице
 * стоит название типа и зоны, а `id` остаётся рядом, а не вместо названия.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { buildInventory } from '../../domain/inventory';
import { InventoryPanel } from './InventoryPanel';

afterEach(cleanup);

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const plan: PlanDocument = parsed.value;

function renderPanel() {
  const onFocus = vi.fn();
  render(<InventoryPanel inventory={buildInventory(plan)} document={plan} onFocus={onFocus} />);
  return { onFocus };
}

/** Панель без документа: композиция приложения ещё не передаёт его в пропсах. */
function renderWithoutDocument() {
  render(<InventoryPanel inventory={buildInventory(plan)} onFocus={vi.fn()} />);
}

/** Строки перечня — первая таблица панели, как их видит браузерный сценарий. */
function objectRows(): HTMLElement[] {
  const tables = screen.getByLabelText('Инвентаризация').querySelectorAll('table');
  const body = tables[0]?.querySelector('tbody');
  return [...(body?.querySelectorAll('tr') ?? [])];
}

function chips(): HTMLElement[] {
  return screen.getAllByTestId('inventory-type');
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
