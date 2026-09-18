// @vitest-environment jsdom
/**
 * D01: подпись под сценой обязана говорить то же, что сама сцена. Со скрытым
 * слоем список примитивов пустеет, и если счётчики продолжают считать по
 * документу, подпись сообщает о зонах и объектах, которых на экране нет.
 *
 * WebGL в jsdom нет, поэтому холст не монтируется: здесь проверяется ровно
 * текстовая половина вида — та, что и в браузере остаётся при любой беде с GPU.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
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

/** Подпись с переносами строк из JSX — сравнивать её удобно одной строкой. */
function caption(): string {
  return (screen.getByTestId('view3d').textContent ?? '').replace(/\s+/g, ' ');
}

afterEach(cleanup);

describe('View3D: подпись под сценой', () => {
  test('видимый слой: счётчики совпадают со списком примитивов, о скрытом молчим', () => {
    render(<View3D document={plan} selection={null} />);

    expect(caption()).toContain('Зон: 1, объектов: 1');
    expect(caption()).not.toContain('Скрытые слои');
    expect(screen.getByTestId('view3d-primitives').children).toHaveLength(2);
  });

  test('слой выключен: в подписи нули и число элементов вне вида', () => {
    render(<View3D document={hidden} selection={null} />);

    expect(caption()).toContain('Зон: 0, объектов: 0');
    expect(caption()).toContain('элементов вне вида — 2');
    expect(screen.getByTestId('view3d-primitives').children).toHaveLength(0);
  });
});
