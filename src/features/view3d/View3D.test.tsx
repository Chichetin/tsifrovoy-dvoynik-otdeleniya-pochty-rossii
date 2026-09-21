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

/** Подпись с переносами строк из JSX — сравнивать её удобно одной строкой. */
function caption(): string {
  return (screen.getByTestId('view3d').textContent ?? '').replace(/\s+/g, ' ');
}

afterEach(cleanup);

describe('View3D: подпись под сценой', () => {
  test('видимый слой: счётчики совпадают со списком примитивов, о скрытом молчим', () => {
    render(<View3D document={plan} selection={null} onSelect={vi.fn()} />);

    expect(caption()).toContain('Зон: 1, объектов: 1');
    expect(caption()).not.toContain('Скрытые слои');
    const list = screen.getByTestId('view3d-primitives');
    expect(list.children).toHaveLength(2);
    expect(list.textContent).toContain('Клиентская зона');
    expect(list.textContent).toContain('Рабочее место 1');
    expect(list.textContent).not.toContain('z_client');
    expect(list.textContent).not.toContain('eq_work_1');
    expect(list.querySelector('[data-id="z_client"]')).not.toBeNull();
    expect(list.querySelector('[data-id="eq_work_1"]')).not.toBeNull();
  });

  test('слой выключен: в подписи нули и число элементов вне вида', () => {
    render(<View3D document={hidden} selection={null} onSelect={vi.fn()} />);

    expect(caption()).toContain('Зон: 0, объектов: 0');
    expect(caption()).toContain('элементов вне вида — 2');
    expect(screen.getByTestId('view3d-primitives').children).toHaveLength(0);
  });
  test('кнопка примитива выбирает его через общую сессию', () => {
    const onSelect = vi.fn();
    render(<View3D document={plan} selection={null} onSelect={onSelect} />);

    screen.getByRole('button', { name: /Рабочее место 1/ }).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'object', id: 'eq_work_1' });
  });

  test('выбор из общей сессии назван явно и ведёт к панели свойств', () => {
    render(<View3D document={plan} selection={{ kind: 'object', id: 'eq_work_1' }} onSelect={vi.fn()} />);

    expect(screen.getByTestId('view3d-selection').textContent).toContain(
      'Выбрано: Рабочее место 1. Свойства можно изменить в панели справа.',
    );
    expect(caption()).toContain('Кликните по объекту в сцене или в списке');
  });
});
