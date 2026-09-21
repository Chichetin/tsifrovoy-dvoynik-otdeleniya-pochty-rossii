// @vitest-environment jsdom
/**
 * U03: панель инструментов — то, что она обещает пользователю.
 *
 * Панель не хранит состояния: активный инструмент приходит из сессии, а отказ
 * жеста — из `notice`, единственного канала между слоем на canvas и DOM.
 * Проверяем видимое: активная кнопка, одна команда удаления на клик и текст
 * отказа, который иначе никуда не попадёт.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../contracts/commands';
import type { Catalog, PlanDocument, Ref, Result } from '../../contracts/model';
import type { EditorSession } from '../../contracts/ui';
import { PlanTools } from './PlanTools';
import { SELF_INTERSECTION_NOTICE, getNotice, setNotice } from './notice';

const catalog: Catalog = {
  version: '1.0.0',
  objectTypes: [],
  zoneTypes: [{ id: 'zt_client', label: 'Клиентская зона', color: '#D0EBFF', attributes: [] }],
  layerTypes: [],
  rules: [],
};

const plan: PlanDocument = {
  schemaVersion: 1,
  id: 'plan_test',
  name: 'Тестовый план',
  room: {
    id: 'room_main',
    boundary: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    ceilingHeight_m: 3,
  },
  walls: [{ id: 'w_north', from: [0, 4], to: [6, 4], thickness_m: 0.2, height_m: 3 }],
  openings: [
    {
      id: 'op_entrance',
      wallId: 'w_north',
      offset_m: 2,
      width_m: 1.2,
      kind: 'entrance',
      sill_m: 0,
      height_m: 2.1,
    },
  ],
  layers: [{ id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null }],
  zones: [
    {
      id: 'z_hall',
      typeId: 'zt_client',
      name: 'Клиентский зал',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      parentId: null,
      layerId: 'l_base',
      attributes: {},
    },
  ],
  objects: [],
  catalog,
  extensions: {},
};

function show(selection: Ref | null): { commands: Command[]; onTool: ReturnType<typeof vi.fn> } {
  const commands: Command[] = [];
  const onCommand = (command: Command): Result<PlanDocument> => {
    commands.push(command);
    return { ok: true, value: plan };
  };
  const onTool = vi.fn();
  const session: EditorSession = {
    tool: { kind: 'select' },
    viewport: { origin: [0, 0], scale: 50 },
    selection,
    preview: null,
    focus: null,
  };
  render(<PlanTools document={plan} session={session} onTool={onTool} onCommand={onCommand} />);
  return { commands, onTool };
}

/** Панель с управляемыми планом и выбором: для проверки, когда гаснет отказ. */
function showWith(document: PlanDocument, selection: Ref | null) {
  const session = (ref: Ref | null): EditorSession => ({
    tool: { kind: 'select' },
    viewport: { origin: [0, 0], scale: 50 },
    selection: ref,
    preview: null,
    focus: null,
  });
  const noop = (): Result<PlanDocument> => ({ ok: true, value: document });
  const view = render(
    <PlanTools document={document} session={session(selection)} onTool={vi.fn()} onCommand={noop} />,
  );
  return (next: PlanDocument, ref: Ref | null): void => {
    view.rerender(
      <PlanTools document={next} session={session(ref)} onTool={vi.fn()} onCommand={noop} />,
    );
  };
}

beforeEach(() => act(() => setNotice(null)));
afterEach(() => cleanup());

describe('панель инструментов плана', () => {
  it('инструмент выбирается и отмечается как нажатый', () => {
    const { onTool } = show(null);
    const zone = screen.getByRole('button', { name: 'Зона' });
    expect(zone.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Выбор' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(zone);
    expect(onTool).toHaveBeenCalledWith({ kind: 'zone.draw' });
  });

  it('подсказки инструментов называют Alt, который отключает привязку', () => {
    show(null);
    for (const name of ['Выбор', 'Помещение', 'Зона', 'Перегородка']) {
      expect(screen.getByRole('button', { name }).getAttribute('title')).toContain('Alt — без привязки');
    }
  });

  it('подсказка панорамирования называет тачпад и среднюю кнопку', () => {
    const { onTool } = show(null);
    fireEvent.click(screen.getByRole('button', { name: 'Обзор' }));

    expect(onTool).toHaveBeenCalledWith({ kind: 'pan' });
    expect(screen.getByRole('button', { name: 'Обзор' }).getAttribute('title')).toContain(
      'свайп двумя пальцами на тачпаде',
    );
  });

  it('разделитель групп один, он декоративный и не мешает клавиатуре (D-248)', () => {
    show(null);
    const gaps = window.document.querySelectorAll('.toolbar__group-gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(gaps[0]!.hasAttribute('tabindex')).toBe(false);
    // Он стоит между группой вида и инструментами создания геометрии.
    expect(gaps[0]!.previousElementSibling?.textContent).toBe('Обзор');
    expect(gaps[0]!.nextElementSibling?.textContent).toBe('Помещение');
  });

  it('без выбора удалять нечего', () => {
    show(null);
    expect(screen.queryByRole('button', { name: /Удалить/ })).toBeNull();
  });

  it('удаляет выбранную зону, перегородку и проём своими командами', () => {
    const zone = show({ kind: 'zone', id: 'z_hall' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить зону' }));
    expect(zone.commands).toEqual([{ type: 'zone.delete', id: 'z_hall' }]);
    cleanup();

    const wall = show({ kind: 'wall', id: 'w_north' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить перегородку' }));
    expect(wall.commands).toEqual([{ type: 'wall.delete', id: 'w_north' }]);
    cleanup();

    const opening = show({ kind: 'opening', id: 'op_entrance' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить проём' }));
    expect(opening.commands).toEqual([{ type: 'opening.delete', id: 'op_entrance' }]);
  });

  it('объект удаляет свой модуль: кнопки плана для него нет', () => {
    show({ kind: 'object', id: 'eq_1' });
    expect(screen.queryByRole('button', { name: /Удалить/ })).toBeNull();
  });

  it('выбранный контур подсказывает, чем его править', () => {
    show({ kind: 'zone', id: 'z_hall' });
    expect(screen.getByText(/тяните вершину/)).toBeDefined();
    expect(screen.getByText(/Alt — без привязки/)).toBeDefined();
  });

  it('отказ гаснет при смене выделения: он был про прошлую фигуру', () => {
    const rerender = showWith(plan, { kind: 'zone', id: 'z_hall' });
    act(() => setNotice(SELF_INTERSECTION_NOTICE));
    expect(screen.getByTestId('plan-tools-notice')).toBeDefined();

    // Тот же выбор — сообщение на месте: его ещё не прочитали.
    act(() => rerender(plan, { kind: 'zone', id: 'z_hall' }));
    expect(screen.queryByTestId('plan-tools-notice')).not.toBeNull();

    act(() => rerender(plan, { kind: 'wall', id: 'w_north' }));
    expect(screen.queryByTestId('plan-tools-notice')).toBeNull();
    expect(getNotice()).toBeNull();
  });

  it('отказ гаснет при смене документа: «Новый» и открытие файла', () => {
    const rerender = showWith(plan, null);
    act(() => setNotice(SELF_INTERSECTION_NOTICE));

    // Правка того же документа сообщение не трогает.
    act(() => rerender({ ...plan, zones: [] }, null));
    expect(screen.queryByTestId('plan-tools-notice')).not.toBeNull();

    act(() => rerender({ ...plan, id: 'plan_new', name: 'Новое отделение' }, null));
    expect(screen.queryByTestId('plan-tools-notice')).toBeNull();
  });

  it('удалить зону на скрытом слое нечем: кнопка исчезает вместе со слоем', () => {
    const hidden: PlanDocument = {
      ...plan,
      layers: [{ ...plan.layers[0]!, visible: false }],
    };
    showWith(hidden, { kind: 'zone', id: 'z_hall' });
    expect(screen.queryByRole('button', { name: /Удалить/ })).toBeNull();
  });

  it('отказ жеста виден в DOM и снимается следующим сообщением', () => {
    show({ kind: 'zone', id: 'z_hall' });
    expect(screen.queryByTestId('plan-tools-notice')).toBeNull();

    act(() => setNotice(SELF_INTERSECTION_NOTICE));
    expect(screen.getByTestId('plan-tools-notice').textContent).toBe(SELF_INTERSECTION_NOTICE);

    act(() => setNotice(null));
    expect(screen.queryByTestId('plan-tools-notice')).toBeNull();
  });
});
