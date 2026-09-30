// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { Equipment, PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { ApprovalSheet } from './ApprovalSheet';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const base = parsed.value;
if (base.objects[0] === undefined) throw new Error('в minimal.json нет объектов');
const source: Equipment = base.objects[0]!;

function objectAt(id: string, label: string, x: number): PlanDocument['objects'][number] {
  return { ...source, id, label, position: [x, source.position[1]] };
}

const before: PlanDocument = { ...base, objects: [objectAt('eq_a', 'Стойка А', 2), objectAt('eq_b', 'Стойка Б', 5)] };
const after: PlanDocument = {
  ...base,
  objects: [objectAt('eq_a', 'Стойка А', 3.5), objectAt('eq_c', 'Стойка В', 6)],
};

afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(window, 'print', { value: vi.fn(), writable: true, configurable: true });
});

test('показывает штамп, картинки, эффект и изменения по названиям', () => {
  const onClose = vi.fn();
  render(<ApprovalSheet before={before} after={after} beforeSource="before.json" onClose={onClose} />);

  expect(screen.getByRole('dialog', { name: 'Лист согласования перепланировки' })).not.toBeNull();
  expect(screen.getByTestId('approval-sheet-plan-name').textContent).toBe(base.name);
  expect(screen.getByTestId('approval-sheet-before-source').textContent).toBe('before.json');
  expect(screen.getByTestId('approval-sheet-before').querySelector('svg')).toBeTruthy();
  expect(screen.getByTestId('approval-sheet-after').querySelector('svg')).toBeTruthy();

  const author = screen.getByTestId('approval-sheet-author') as HTMLInputElement;
  expect(author.value).toBe('');
  fireEvent.change(author, { target: { value: 'Иванова И. И., руководитель ОПС' } });
  expect(author.value).toBe('Иванова И. И., руководитель ОПС');

  const changesText = screen.getByTestId('approval-sheet-changes').textContent ?? '';
  expect(changesText).toContain('Добавлен: Стойка В');
  expect(changesText).toContain('(eq_c)');
  expect(changesText).toContain('Удалён: Стойка Б');
  expect(changesText).toContain('(eq_b)');
  expect(changesText).toContain('Перемещён: Стойка А');
  expect(changesText).toContain('(eq_a)');

  expect(screen.getByTestId('approval-sheet-metric-area.free')).not.toBeNull();
  expect(screen.getByTestId('approval-sheet-metric-equipment.count').textContent).toContain('2');
  expect(screen.getByText(/не норматив Почты России/)).not.toBeNull();

  fireEvent.click(screen.getByTestId('approval-sheet-print'));
  expect(window.print).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByTestId('approval-sheet-close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape закрывает лист', () => {
  const onClose = vi.fn();
  render(<ApprovalSheet before={before} after={after} beforeSource="before.json" onClose={onClose} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('клик по подложке закрывает, клик внутри панели — нет', () => {
  const onClose = vi.fn();
  render(<ApprovalSheet before={before} after={after} beforeSource="before.json" onClose={onClose} />);
  fireEvent.pointerDown(screen.getByTestId('approval-sheet'));
  expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();
  fireEvent.pointerDown(screen.getByRole('dialog'));
  expect(onClose).not.toHaveBeenCalled();
});

test('несвязанные планы: предупреждение вместо списка изменений', () => {
  const other: PlanDocument = { ...base, id: 'plan_other', objects: [objectAt('eq_x', 'Другое', 1)] };
  render(<ApprovalSheet before={other} after={after} beforeSource="other.json" onClose={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('разные ID планов');
  expect(screen.getByText('Сопоставление предметов не подтверждено: у файлов разные ID планов.')).not.toBeNull();
  expect(screen.queryByTestId('approval-sheet-changes')).toBeNull();
});

test('невычислимая геометрия — отказ, а не пустой лист без объяснения', () => {
  const broken: PlanDocument = {
    ...before,
    room: { ...before.room, boundary: [[0, 0], [4, 4], [4, 0], [0, 4]] },
  };
  render(<ApprovalSheet before={broken} after={after} beforeSource="before.json" onClose={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('Лист не собран');
  expect((screen.getByTestId('approval-sheet-print') as HTMLButtonElement).disabled).toBe(true);
});
