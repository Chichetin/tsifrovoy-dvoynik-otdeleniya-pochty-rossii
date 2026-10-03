// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { PlanTitle } from './PlanTitle';

afterEach(() => {
  cleanup();
});

function open(name = 'ОПС 115534'): HTMLInputElement {
  fireEvent.click(screen.getByRole('button', { name: `Переименовать план «${name}»` }));
  return screen.getByLabelText('Новое название плана') as HTMLInputElement;
}

test('shows the plan name and the save state as text, not only as a mark', () => {
  const { rerender } = render(<PlanTitle name="ОПС 115534" dirty onRename={() => true} />);
  expect(screen.getByRole('button', { name: 'Переименовать план «ОПС 115534»' }).textContent).toContain('ОПС 115534');
  expect(screen.getByRole('status').textContent).toBe('Есть несохранённые правки');

  rerender(<PlanTitle name="ОПС 115534" dirty={false} onRename={() => true} />);
  expect(screen.getByRole('status').textContent).toBe('Сохранено в файл');
});

test('Enter renames with the typed name and leaves editing', () => {
  const onRename = vi.fn(() => true);
  render(<PlanTitle name="ОПС 115534" dirty={false} onRename={onRename} />);
  const input = open();
  expect(input.value).toBe('ОПС 115534');
  fireEvent.change(input, { target: { value: 'ОПС 115534 после' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledWith('ОПС 115534 после');
  expect(screen.queryByLabelText('Новое название плана')).toBeNull();
});

test('leaving the field renames too', () => {
  const onRename = vi.fn(() => true);
  render(<PlanTitle name="ОПС 115534" dirty={false} onRename={onRename} />);
  const input = open();
  fireEvent.change(input, { target: { value: 'Новое' } });
  fireEvent.blur(input);
  expect(onRename).toHaveBeenCalledWith('Новое');
});

test('Escape cancels without a command and returns focus to the name', () => {
  const onRename = vi.fn(() => true);
  render(<PlanTitle name="ОПС 115534" dirty={false} onRename={onRename} />);
  const input = open();
  fireEvent.change(input, { target: { value: 'Черновик' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(onRename).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Переименовать план «ОПС 115534»' }));
});

test('an unchanged name sends nothing', () => {
  const onRename = vi.fn(() => true);
  render(<PlanTitle name="ОПС 115534" dirty={false} onRename={onRename} />);
  fireEvent.keyDown(open(), { key: 'Enter' });
  expect(onRename).not.toHaveBeenCalled();
});

test('an empty name on Enter keeps the field with a hint tied to it; leaving it cancels', () => {
  const onRename = vi.fn(() => true);
  render(<PlanTitle name="ОПС 115534" dirty={false} onRename={onRename} />);
  const input = open();
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).not.toHaveBeenCalled();
  const hint = screen.getByText('У плана должно быть название.');
  expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  expect(input.getAttribute('aria-invalid')).toBe('true');

  fireEvent.blur(input);
  expect(onRename).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Новое название плана')).toBeNull();
});

test('a refused rename keeps the field open for another try', () => {
  render(<PlanTitle name="ОПС 115534" dirty={false} onRename={() => false} />);
  const input = open();
  fireEvent.change(input, { target: { value: 'Новое' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByLabelText('Новое название плана')).toBeTruthy();
});
