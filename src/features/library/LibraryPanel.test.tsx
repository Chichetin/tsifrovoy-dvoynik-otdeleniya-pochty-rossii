// @vitest-environment jsdom
/**
 * U07: библиотека читается по-русски и доступна с клавиатуры и экранного диктора.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import { parsePlanDocument } from '../../contracts/schema';
import { LibraryPanel } from './LibraryPanel';

afterEach(cleanup);

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const catalog = parsed.value.catalog;

function withSize(width: number, depth: number) {
  const source = catalog.objectTypes[0];
  if (source === undefined) throw new Error('в minimal.json нет типов');
  return {
    ...catalog,
    objectTypes: [{ ...source, id: 'ot_sized', label: 'Проверочный тип', defaultSize_m: [width, depth] as [number, number] }],
  };
}

test('габарит типа записан с запятой, «м» не отрывается от числа', () => {
  render(<LibraryPanel catalog={withSize(1.25, 0.6)} onTool={vi.fn()} />);
  const size = screen.getByRole('button', { name: /Проверочный тип/ }).querySelector('.library__size');
  expect(size?.textContent).toBe('1,25×0,6\u00a0м');
});

test('поле поиска подписано, образец цвета скрыт от диктора', () => {
  render(<LibraryPanel catalog={withSize(1, 1)} onTool={vi.fn()} />);
  const search = screen.getByRole('searchbox', { name: 'Поиск в библиотеке' });
  fireEvent.change(search, { target: { value: 'нет такого' } });
  expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  fireEvent.change(search, { target: { value: '' } });
  const swatch = document.querySelector('.library__swatch');
  expect(swatch?.getAttribute('aria-hidden')).toBe('true');
});
