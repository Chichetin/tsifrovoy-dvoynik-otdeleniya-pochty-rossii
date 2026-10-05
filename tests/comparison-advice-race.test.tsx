// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdviceResponse } from '../src/contracts/advice';
import type { Result } from '../src/contracts/model';
import before from '../demo/before.json';

const mocked = vi.hoisted(() => ({ resolve: null as null | ((value: Result<AdviceResponse>) => void) }));
vi.mock('../src/features/assistant/advice-client', () => ({
  requestAdvice: vi.fn(() => new Promise<Result<AdviceResponse>>((resolve) => { mocked.resolve = resolve; })),
}));
import { App } from '../src/app/App';

afterEach(() => { cleanup(); mocked.resolve = null; window.localStorage.clear(); });

function selectSource(): void {
  const file = new File([JSON.stringify(before)], 'before.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(before) });
  fireEvent.change(screen.getByTestId('comparison-file-input'), { target: { files: [file] } });
}

test('выбор другой базы исключает поздний ответ прежнего сравнения', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Ассистент' }));
  fireEvent.change(screen.getByLabelText('Сценарий'), { target: { value: 'compare' } });
  fireEvent.click(screen.getByRole('button', { name: 'Спросить' }));
  expect(mocked.resolve).not.toBeNull();
  selectSource();
  await waitFor(() => expect(screen.getByRole('region', { name: 'Сравнение планов' }).textContent).toContain('before.json'));
  await act(async () => mocked.resolve!({ ok: true, value: {
    revision: 0, recommendations: [], explanations: [], mode: 'fallback', fallbackReason: 'ответ старой базы',
  } }));
  expect(screen.queryByText(/ответ старой базы/)).toBeNull();
  // The app opens the demo at start (#111), so before.json is the same plan: related, and the old request is gone.
  expect(screen.getByRole('button', { name: 'Спросить' })).toHaveProperty('disabled', false);
}, 20_000);

test('новый документ сбрасывает внешний исходный файл', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Ассистент' }));
  fireEvent.change(screen.getByLabelText('Сценарий'), { target: { value: 'compare' } });
  selectSource();
  await waitFor(() => expect(screen.getByRole('region', { name: 'Сравнение планов' }).textContent).toContain('before.json'));
  fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Создать новый' }));
  expect(screen.getByRole('region', { name: 'Сравнение планов' }).textContent).not.toContain('before.json');
  expect(screen.getByRole('button', { name: 'Спросить' })).toHaveProperty('disabled', false);
}, 20_000);
