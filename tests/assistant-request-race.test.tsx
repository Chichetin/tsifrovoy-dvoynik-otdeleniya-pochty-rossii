// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdviceResponse } from '../src/contracts/advice';
import type { Result } from '../src/contracts/model';

type AdviceResult = Result<AdviceResponse>;
type Pending = { promise: Promise<AdviceResult>; resolve: (value: AdviceResult) => void };

const mocked = vi.hoisted(() => ({ pending: [] as Pending[] }));

vi.mock('../src/features/assistant/advice-client', () => ({
  requestAdvice: vi.fn(() => {
    let resolve!: (value: AdviceResult) => void;
    const promise = new Promise<AdviceResult>((done) => {
      resolve = done;
    });
    mocked.pending.push({ promise, resolve });
    return promise;
  }),
}));

import { App } from '../src/app/App';

afterEach(() => {
  cleanup();
  mocked.pending.length = 0;
  window.localStorage.clear();
});

function answer(reason: string): AdviceResult {
  return {
    ok: true,
    value: {
      revision: 0,
      recommendations: [],
      explanations: [],
      mode: 'fallback',
      fallbackReason: reason,
    },
  };
}

test('поздний ответ старого плана не заменяет ответ нового плана', async () => {
  render(<App />);
  // D-249: the assistant is a tab of the right column, not open by default.
  fireEvent.click(screen.getByRole('tab', { name: 'Ассистент' }));

  fireEvent.click(screen.getByRole('button', { name: 'Спросить' }));
  expect(mocked.pending).toHaveLength(1);

  // A new store also starts at revision 0. The request sequence, rather than
  // the revision alone, must distinguish its answer from the old document.
  fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
  fireEvent.click(screen.getByRole('button', { name: 'Спросить' }));
  expect(mocked.pending).toHaveLength(2);

  await act(async () => mocked.pending[0]!.resolve(answer('старый ответ')));
  expect(screen.getByText('Считаем рекомендации…')).toBeDefined();
  expect(screen.queryByText(/старый ответ/)).toBeNull();

  await act(async () => mocked.pending[1]!.resolve(answer('новый ответ')));
  await waitFor(() => expect(screen.getByText(/новый ответ/)).toBeDefined());
  expect(screen.queryByText(/старый ответ/)).toBeNull();
});
