// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';
import { applyCommand } from '../domain/commands';
import { SettingsDialog } from './SettingsDialog';

afterEach(cleanup);

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan: PlanDocument = parsed.value;

/** The dialog over a live plan: every accepted command changes what it shows. */
function Live({ onClose = () => {} }: { onClose?: () => void }): React.JSX.Element {
  const [document, setDocument] = useState(plan);
  return (
    <SettingsDialog
      open
      onClose={onClose}
      document={document}
      onCommand={(command) => {
        const result = applyCommand(document, command);
        if (result.ok) setDocument(result.value);
        return result;
      }}
    />
  );
}

test('opens on the «План» section with the plan name and ceiling height', () => {
  render(<Live />);
  expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'План' }).getAttribute('aria-current')).toBe('true');
  expect((screen.getByLabelText('Название плана') as HTMLInputElement).value).toBe(plan.name);
  expect((screen.getByLabelText('Высота потолка, м') as HTMLInputElement).value).toBe(String(plan.room.ceilingHeight_m));
});

test('the plan name types character by character, the space between words stays', () => {
  render(<Live />);
  const input = screen.getByLabelText('Название плана') as HTMLInputElement;
  for (const typed of ['О', 'ОП', 'ОПС', 'ОПС ', 'ОПС 7']) {
    fireEvent.change(input, { target: { value: typed } });
    expect(input.value).toBe(typed);
  }
});

test('a refused value stays in its field with the reason', () => {
  render(<Live />);
  fireEvent.change(screen.getByLabelText('Название плана'), { target: { value: '   ' } });
  expect(screen.getByRole('alert').textContent).toContain('название');
  expect((screen.getByLabelText('Название плана') as HTMLInputElement).value).toBe('   ');

  fireEvent.change(screen.getByLabelText('Высота потолка, м'), { target: { value: '' } });
  expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain('Нужно число.');
});

test('the catalog sections replace the «Справочник» tab', () => {
  render(<Live />);
  fireEvent.click(screen.getByRole('button', { name: 'Оборудование' }));
  expect(screen.getByRole('button', { name: 'Оборудование' }).getAttribute('aria-current')).toBe('true');
  expect(screen.getByRole('region', { name: 'Типы оборудования' })).toBeTruthy();
  expect(screen.queryByLabelText('Название плана')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Зоны' }));
  expect(screen.getByRole('region', { name: 'Типы зон' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Правила' }));
  expect(screen.getByRole('region', { name: 'Правила комплектования' })).toBeTruthy();
});

test('Escape, the close button and a press outside close it; a press inside does not', () => {
  const onClose = vi.fn();
  render(<Live onClose={onClose} />);
  fireEvent.mouseDown(screen.getByRole('dialog'));
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть настройки' }));
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  expect(onClose).toHaveBeenCalledTimes(3);
});

test('keys stay inside: the editor behind does not see them, Tab cycles within the dialog', () => {
  const editor = vi.fn();
  window.addEventListener('keydown', editor);
  render(<Live />);
  const close = screen.getByRole('button', { name: 'Закрыть настройки' });
  close.focus();
  fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });
  expect(editor).not.toHaveBeenCalled();

  fireEvent.keyDown(window, { key: 'Tab', code: 'Tab', shiftKey: true });
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(close);
  window.removeEventListener('keydown', editor);
});

test('closing returns focus to what opened it', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const { rerender } = render(<SettingsDialog open onClose={() => {}} document={plan} onCommand={vi.fn()} />);
  expect(document.activeElement).not.toBe(opener);
  rerender(<SettingsDialog open={false} onClose={() => {}} document={plan} onCommand={vi.fn()} />);
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
