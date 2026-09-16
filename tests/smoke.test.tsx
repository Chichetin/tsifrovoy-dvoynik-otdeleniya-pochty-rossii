import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from '../src/app/App';

test('app mounts and shows the product title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeDefined();
});
