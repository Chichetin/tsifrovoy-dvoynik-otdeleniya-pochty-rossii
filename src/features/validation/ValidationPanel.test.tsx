// @vitest-environment jsdom
/**
 * V02: находка должна называть вещь, а не только её `id`.
 *
 * Список проверок читает тот, кто пойдёт двигать оборудование: «Скамья 1
 * пересекает Рабочее место 1» он поймёт, «eq_bench_1 / eq_work_1» — нет.
 * При этом `id` остаётся в строке: им говорят карточка, ассистент и файл.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { Issue, PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { ValidationPanel } from './ValidationPanel';

afterEach(cleanup);

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const plan: PlanDocument = parsed.value;

const collision: Issue = {
  code: 'OBJECTS_OVERLAP',
  severity: 'error',
  message: 'Объекты пересекаются',
  refs: [
    { kind: 'object', id: 'eq_bench_1' },
    { kind: 'zone', id: 'z_client' },
  ],
};

function renderPanel(issues: Issue[], document: PlanDocument | undefined) {
  const onFocus = vi.fn();
  render(<ValidationPanel issues={issues} document={document} onFocus={onFocus} />);
  return { onFocus };
}

describe('названия в находках', () => {
  test('рядом с кодом стоят названия объекта и зоны, а id — вторым текстом', () => {
    renderPanel([collision], plan);
    const item = within(screen.getByRole('listitem'));

    expect(item.getByRole('button', { name: /Скамья 1/ })).not.toBeNull();
    expect(item.getByText('eq_bench_1')).not.toBeNull();
    expect(item.getByRole('button', { name: /Клиентская зона/ })).not.toBeNull();
    expect(item.getByText('z_client')).not.toBeNull();
    expect(screen.getByText('OBJECTS_OVERLAP')).not.toBeNull();
  });

  test('клик по находке ведёт к тому, о чём она', () => {
    const { onFocus } = renderPanel([collision], plan);

    fireEvent.click(screen.getByRole('button', { name: /Скамья 1/ }));

    expect(onFocus).toHaveBeenCalledWith({ kind: 'object', id: 'eq_bench_1' });
  });

  test('id, которого в плане уже нет, показан как есть', () => {
    const ghost: Issue = { ...collision, refs: [{ kind: 'object', id: 'eq_ghost' }] };
    renderPanel([ghost], plan);

    expect(screen.getByRole('button', { name: 'eq_ghost' })).not.toBeNull();
  });

  test('без документа панель показывает id и не ломается', () => {
    renderPanel([collision], undefined);

    expect(screen.getByRole('button', { name: 'eq_bench_1' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'z_client' })).not.toBeNull();
  });

  test('ошибки идут раньше предупреждений', () => {
    const warning: Issue = { ...collision, code: 'BENCH_MIN', severity: 'warning', refs: [] };
    renderPanel([warning, collision], plan);

    expect(screen.getAllByRole('listitem').map((item) => item.className)).toEqual([
      'issues__item is-error',
      'issues__item is-warning',
    ]);
  });

  test('нарушений нет — панель говорит об этом, а не показывает пустоту', () => {
    renderPanel([], plan);

    expect(screen.getByText('Нарушений не найдено')).not.toBeNull();
  });
});
