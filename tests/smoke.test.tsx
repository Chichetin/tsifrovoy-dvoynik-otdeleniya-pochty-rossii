// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { App } from '../src/app/App';

// Without vitest globals Testing Library does not unmount by itself, and the
// whole App stayed mounted while jsdom was torn down — work React had queued
// could then fail after the test (jury 19.09 saw one «Errors 1 error» from this
// file). Not reproduced (20/20 alone, 40/40 eight in parallel): prevention.
afterEach(cleanup);

test('app mounts and shows the product title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeDefined();
});
