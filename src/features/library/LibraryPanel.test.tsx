// @vitest-environment jsdom
/**
 * U07: библиотека читается по-русски и доступна с клавиатуры и экранного диктора.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { ObjectType } from '../../contracts/model';
import { PLAN_PICTOGRAM_PATHS, planPictogram } from '../../domain/plan-pictogram';
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
  render(<LibraryPanel catalog={withSize(1.25, 0.6)} activeTypeId={null} onTool={vi.fn()} />);
  const size = screen.getByRole('button', { name: /Проверочный тип/ }).querySelector('.library__size');
  expect(size?.textContent).toBe('1,25×0,6\u00a0м');
});

test('поле поиска подписано, образец цвета скрыт от диктора', () => {
  render(<LibraryPanel catalog={withSize(1, 1)} activeTypeId={null} onTool={vi.fn()} />);
  const search = screen.getByRole('searchbox', { name: 'Поиск в библиотеке' });
  fireEvent.change(search, { target: { value: 'нет такого' } });
  expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  fireEvent.change(search, { target: { value: '' } });
  const swatch = document.querySelector('.library__swatch');
  expect(swatch?.getAttribute('aria-hidden')).toBe('true');
});

test('вооружённый тип заметно выделен и сообщён как нажатый', () => {
  const sized = withSize(1, 1);
  const onTool = vi.fn();
  render(<LibraryPanel catalog={sized} activeTypeId="ot_sized" onTool={onTool} />);

  const item = screen.getByRole('button', { name: /Проверочный тип/, pressed: true });
  expect(item.classList.contains('is-selected')).toBe(true);
  fireEvent.click(item);
  expect(onTool).toHaveBeenCalledWith({ kind: 'select' });
});

test('перетаскивание типа вооружает тот же инструмент и передаёт его id', () => {
  const sized = withSize(1, 1);
  const onTool = vi.fn();
  render(<LibraryPanel catalog={sized} activeTypeId={null} onTool={onTool} />);

  const setData = vi.fn();
  const item = screen.getByRole('button', { name: /Проверочный тип/ });
  fireEvent.dragStart(item, { dataTransfer: { effectAllowed: '', setData } });

  expect(onTool).toHaveBeenCalledWith({ kind: 'object.place', typeId: 'ot_sized' });
  expect(setData).toHaveBeenCalledWith('text/plain', 'ot_sized');
  expect(item.getAttribute('draggable')).toBe('true');
});

test('тип с формой показывает свой контур вместо квадрата (D-279)', () => {
  const sized = withSize(1, 1);
  const shaped = {
    ...sized,
    objectTypes: [{ ...sized.objectTypes[0]!, outline: [[0, 0.5], [-0.5, -0.5], [0.5, -0.5]] as [number, number][] }],
  };
  render(<LibraryPanel catalog={shaped} activeTypeId={null} onTool={vi.fn()} />);
  const icon = screen.getByTestId('library-shape-ot_sized');
  expect(icon.getAttribute('aria-hidden')).toBe('true');
  // Model Y is up, SVG's is down: the apex at +0.5 is drawn at the top.
  expect(icon.querySelector('polygon')?.getAttribute('points')).toBe('0,-0.5 -0.5,0.5 0.5,0.5');
});

test('«Нарисовать свою фигуру» берёт выбранный тип, без типа — подсказка, не молчание (D-279)', () => {
  const onTool = vi.fn();
  const { rerender } = render(<LibraryPanel catalog={withSize(1, 1)} activeTypeId={null} onTool={onTool} />);
  fireEvent.click(screen.getByRole('button', { name: 'Нарисовать свою фигуру' }));
  expect(onTool).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('Сначала выберите тип');
  rerender(<LibraryPanel catalog={withSize(1, 1)} activeTypeId="ot_sized" onTool={onTool} />);
  fireEvent.click(screen.getByRole('button', { name: 'Нарисовать свою фигуру' }));
  expect(onTool).toHaveBeenCalledWith({ kind: 'shape.draw', typeId: 'ot_sized' });
});

/**
 * Знак типа рядом с названием: пользователь понимает, что добавляет, до того
 * как объект окажется на плане (заказ участника 22.09). Знак берётся из того
 * же набора, что рисует план и экспорт, поэтому список и план не расходятся.
 */
test('у типа со знаком в строке стоит его знак, а не цветной образец', () => {
  const types = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'catalog', 'object-types.json'), 'utf8'),
  ) as ObjectType[];
  render(
    <LibraryPanel catalog={{ ...catalog, objectTypes: types }} activeTypeId={null} onTool={vi.fn()} />,
  );

  for (const type of types) {
    const icon = document.querySelector(`[data-testid="library-icon-${type.id}"] path`);
    expect(icon, type.label).not.toBeNull();
    expect(icon?.getAttribute('d')).toBe(PLAN_PICTOGRAM_PATHS[planPictogram(type)!]);
  }
});

test('тип с нарисованным контуром оставляет свой контур, а не знак', () => {
  const shaped: ObjectType = {
    ...catalog.objectTypes[0]!,
    id: 'ot_team_corner',
    label: 'Стойка угловая',
    outline: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0],
      [0, 0],
      [0, 0.5],
      [-0.5, 0.5],
    ],
  };
  render(
    <LibraryPanel catalog={{ ...catalog, objectTypes: [shaped] }} activeTypeId={null} onTool={vi.fn()} />,
  );

  expect(document.querySelector('[data-testid="library-shape-ot_team_corner"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="library-icon-ot_team_corner"]')).toBeNull();
});
