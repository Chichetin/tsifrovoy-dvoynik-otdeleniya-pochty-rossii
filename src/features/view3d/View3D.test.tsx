// @vitest-environment jsdom
/**
 * D01: the section's data attributes are obligated to say the same thing the
 * scene itself contains. There is no sidebar list any more — a hidden layer
 * must still be provable without reading pixels, so `data-zones-count` and
 * `data-objects-count` are counted from the scene's prisms, not the document.
 *
 * WebGL в jsdom нет, поэтому холст не монтируется: здесь проверяется ровно
 * текстовая половина вида — та, что и в браузере остаётся при любой беде с GPU.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { View3D } from './View3D';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
/** Одна зона и один объект, оба на единственном слое `l_base`. */
const plan: PlanDocument = parsed.value;
const hidden: PlanDocument = {
  ...plan,
  layers: plan.layers.map((layer) => ({ ...layer, visible: false })),
};

afterEach(cleanup);

describe('View3D: состав сцены в data-атрибутах секции', () => {
  test('видимый слой: счётчики совпадают со сценой', () => {
    render(<View3D document={plan} selection={null} onSelect={vi.fn()} />);

    const section = screen.getByTestId('view3d');
    expect(section.getAttribute('data-zones-count')).toBe('1');
    expect(section.getAttribute('data-objects-count')).toBe('1');
  });

  test('слой выключен: счётчики падают до нуля, как на холсте 2D', () => {
    render(<View3D document={hidden} selection={null} onSelect={vi.fn()} />);

    const section = screen.getByTestId('view3d');
    expect(section.getAttribute('data-zones-count')).toBe('0');
    expect(section.getAttribute('data-objects-count')).toBe('0');
  });

  test('без WebGL — понятное сообщение вместо пустого экрана, а не меню', () => {
    render(<View3D document={plan} selection={null} onSelect={vi.fn()} />);

    expect(screen.getByTestId('view3d-unavailable').textContent).toContain('WebGL');
    expect(screen.queryByTestId('view3d-primitives')).toBeNull();
  });
});
