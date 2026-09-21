// @vitest-environment jsdom
/**
 * Площади — первое, что читает руководитель отделения. Проверяется запись
 * чисел: запятая, «м²» через неразрывный пробел в сводке, единица в подписи
 * таблицы и числовые ячейки, которые выравниваются по правому краю.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { measurePlan } from '../../domain/metrics';
import { formatArea } from '../../domain/number-format';
import { MetricsPanel } from './MetricsPanel';

afterEach(cleanup);

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const plan: PlanDocument = parsed.value;

describe('панель «Площади»', () => {
  test('сводка помещения по-русски: запятая и неразрывная единица', () => {
    const metrics = measurePlan(plan);
    if (!metrics.ok) throw new Error('площади не посчитались');
    render(<MetricsPanel document={plan} metrics={metrics} onFocus={vi.fn()} />);

    const free = screen.getByTestId('room-free').textContent ?? '';
    expect(free).toBe(formatArea(metrics.value.room.free_m2));
    expect(free).toMatch(/^\d[\d\u00a0]*,\d\d\u00a0м²$/);
  });

  test('в таблице зон ни одной точки в числах, числовые ячейки помечены', () => {
    const metrics = measurePlan(plan);
    if (!metrics.ok) throw new Error('площади не посчитались');
    render(<MetricsPanel document={plan} metrics={metrics} onFocus={vi.fn()} />);

    const table = within(screen.getByLabelText('Площади')).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(plan.zones.length);
    for (const row of rows) {
      const numbers = [...row.querySelectorAll('td')].slice(1);
      expect(numbers).toHaveLength(3);
      for (const cell of numbers) {
        expect(cell.className).toContain('metrics__num');
        // Единица сказана один раз, в подписи таблицы; в ячейке только число.
        expect(cell.textContent).toMatch(/^(—|\d[\d\u00a0]*,\d\d)$/);
      }
    }
    const heads = [...table.querySelectorAll('thead th')].slice(1);
    expect(heads.map((head) => head.textContent)).toEqual(['Всего', 'Занято', 'Свободно']);
    expect(table.querySelector('caption')?.textContent).toBe('Площади зон, м²');
    for (const head of heads) expect(head.className).toContain('metrics__num');
  });

  describe('вложенность зон видна в таблице', () => {
    /** `nested.json`: «Зона ожидания» лежит внутри «Клиентской зоны». */
    function table(): HTMLElement {
      const metrics = measurePlan(plan);
      if (!metrics.ok) throw new Error('площади не посчитались');
      render(<MetricsPanel document={plan} metrics={metrics} onFocus={vi.fn()} />);
      return within(screen.getByLabelText('Площади')).getByRole('table');
    }

    test('вложенная зона идёт сразу под родителем и помечена глубиной', () => {
      const rows = within(table()).getAllByRole('row').slice(1);

      expect(rows.map((row) => row.getAttribute('data-depth'))).toEqual(['0', '1', '0']);
      expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual([
        'Клиентская зона',
        '└ Зона ожидания',
        'Служебная зона',
      ]);
    });

    test('список остаётся вертикальной таблицей: по строке на зону, колонки прежние', () => {
      const rows = within(table()).getAllByRole('row').slice(1);

      expect(rows).toHaveLength(plan.zones.length);
      for (const row of rows) expect(within(row).getAllByRole('cell')).toHaveLength(4);
    });

    test('вложенность слышна, а не только видна', () => {
      const nestedRow = within(table())
        .getAllByRole('row')
        .find((row) => row.getAttribute('data-depth') === '1');

      const link = within(nestedRow as HTMLElement).getByRole('button');
      expect(link.getAttribute('aria-label')).toBe('Зона ожидания, внутри зоны Клиентская зона');
      // Значок ветки — только для глаза: скринридер прочтёт его как мусор.
      expect(link.querySelector('.metrics__nested')?.getAttribute('aria-hidden')).toBe('true');
    });

    test('у зоны верхнего уровня нет ни отступа, ни подписи о родителе', () => {
      const rootRow = within(table())
        .getAllByRole('row')
        .find((row) => row.getAttribute('data-depth') === '0');

      const link = within(rootRow as HTMLElement).getByRole('button');
      expect(link.getAttribute('aria-label')).toBeNull();
      expect(link.style.marginInlineStart).toBe('');
    });
  });
});
