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
import type { EditorSession, Tool } from '../../contracts/ui';
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

function show(
  selection: Ref | null,
  tool: Tool = { kind: 'select' },
): { commands: Command[]; onTool: ReturnType<typeof vi.fn> } {
  const commands: Command[] = [];
  const onCommand = (command: Command): Result<PlanDocument> => {
    commands.push(command);
    return { ok: true, value: plan };
  };
  const onTool = vi.fn();
  const session: EditorSession = {
    tool,
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

/**
 * The page around the toolbar: the plan's canvas (the editor marks it with
 * `.editor-canvas`) and a text field of the right column.
 */
function page(): { canvas: HTMLElement; field: HTMLInputElement } {
  const canvas = document.createElement('div');
  canvas.className = 'editor-canvas';
  canvas.append(document.createElement('canvas'));
  const field = document.createElement('input');
  document.body.append(canvas, field);
  return { canvas: canvas.firstElementChild as HTMLElement, field };
}

beforeEach(() => act(() => setNotice(null)));
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

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

  it('подсказки контура говорят, как его закончить: первая точка, Enter, двойной клик (D-262)', () => {
    show(null);
    for (const name of ['Зона']) {
      const title = screen.getByRole('button', { name }).getAttribute('title') ?? '';
      expect(title).toContain('клик по первой точке');
      expect(title).toContain('Enter');
      expect(title).toContain('двойной клик');
      expect(title).toContain('Esc');
    }
  });

  it('подсказка помещения объясняет два угла и отдельный внешний контур', () => {
    show(null);
    const title = screen.getByRole('button', { name: 'Помещение' }).getAttribute('title');
    expect(title).toContain('двумя противоположными углами');
    expect(title).toContain('внешнего контура');
  });

  it('подсказка панорамирования называет тачпад и среднюю кнопку', () => {
    const { onTool } = show(null);
    fireEvent.click(screen.getByRole('button', { name: 'Обзор' }));

    expect(onTool).toHaveBeenCalledWith({ kind: 'pan' });
    expect(screen.getByRole('button', { name: 'Обзор' }).getAttribute('title')).toContain(
      'свайп двумя пальцами на тачпаде',
    );
  });

  it('линейка включается кнопкой и обещает то, что делает (D-256)', () => {
    const { onTool } = show(null);
    const ruler = screen.getByRole('button', { name: 'Линейка' });
    fireEvent.click(ruler);
    expect(onTool).toHaveBeenCalledWith({ kind: 'measure' });
    const title = ruler.getAttribute('title') ?? '';
    expect(title).toContain('Esc');
    expect(title).toContain('В план не попадает');
  });

  it('разделитель групп один, он декоративный и не мешает клавиатуре (D-248)', () => {
    show(null);
    const gaps = window.document.querySelectorAll('.toolbar__group-gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(gaps[0]!.hasAttribute('tabindex')).toBe(false);
    // Он стоит между инструментами, которые план не меняют («Выбор», «Обзор»,
    // «Линейка»), и теми, что создают геометрию (D-256).
    expect(gaps[0]!.previousElementSibling?.textContent).toBe('Линейка');
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
    const { canvas } = page();
    show({ kind: 'zone', id: 'z_hall' });
    fireEvent.pointerDown(canvas);
    expect(screen.getByText(/тяните вершину/)).toBeDefined();
    expect(screen.getByText(/Alt — без привязки/)).toBeDefined();
  });

  it('подсказка контура ждёт холста: выбор из списка её не показывает (D-282)', () => {
    const { canvas, field } = page();
    show({ kind: 'room', id: 'room_main' });
    expect(screen.queryByText(/тяните вершину/)).toBeNull();

    // Клик в правой колонке — всё ещё не холст.
    fireEvent.pointerDown(field);
    expect(screen.queryByText(/тяните вершину/)).toBeNull();

    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();
  });

  it('ушёл с холста — подсказка гаснет, вернулся — видна снова (D-282)', () => {
    const { canvas, field } = page();
    show({ kind: 'zone', id: 'z_hall' });
    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();

    // Фокус в поле ввода — клавиатурой, без мыши.
    fireEvent.focusIn(field);
    expect(screen.queryByText(/тяните вершину/)).toBeNull();

    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();

    fireEvent.pointerDown(field);
    expect(screen.queryByText(/тяните вершину/)).toBeNull();
  });

  it('другой документ начинается без холста: подсказка ждёт клика по плану (D-282)', () => {
    const { canvas } = page();
    const rerender = showWith(plan, { kind: 'room', id: 'room_main' });
    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();

    // Правка того же документа холст не отнимает.
    act(() => rerender({ ...plan, zones: [] }, { kind: 'room', id: 'room_main' }));
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();

    act(() => rerender({ ...plan, id: 'plan_new', name: 'Новое отделение' }, { kind: 'room', id: 'room_main' }));
    expect(screen.queryByText(/тяните вершину/)).toBeNull();
  });

  it('кнопки самой панели холст не отнимают (D-282)', () => {
    const { canvas } = page();
    show({ kind: 'zone', id: 'z_hall' });
    fireEvent.pointerDown(canvas);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Выбор' }));
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();
  });

  it('под другим инструментом подсказки правки нет, даже у холста (D-282)', () => {
    for (const tool of [
      { kind: 'zone.draw' },
      { kind: 'room.draw' },
      { kind: 'wall.draw' },
      { kind: 'opening.place' },
      { kind: 'measure' },
      { kind: 'object.place', typeId: 'ot_x' },
      { kind: 'shape.draw', typeId: 'ot_x' },
    ] as Tool[]) {
      const { canvas } = page();
      show({ kind: 'zone', id: 'z_hall' }, tool);
      fireEvent.pointerDown(canvas);
      expect(screen.queryByText(/тяните вершину/), tool.kind).toBeNull();
      cleanup();
      document.body.replaceChildren();
    }
    const { canvas } = page();
    show({ kind: 'wall', id: 'w_north' }, { kind: 'zone.draw' });
    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/тяните концы/)).toBeNull();
  });

  it('под «Обзором» ручки те же, что под «Выбором», — и подсказка тоже (D-282)', () => {
    const { canvas, field } = page();
    show({ kind: 'zone', id: 'z_hall' }, { kind: 'pan' });
    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/тяните вершину/)).not.toBeNull();

    fireEvent.pointerDown(field);
    expect(screen.queryByText(/тяните вершину/)).toBeNull();
  });

  it('только что поставленный проём под «Проёмом» подсказывает, как его двигать (D-282, D-267)', () => {
    const { canvas, field } = page();
    show({ kind: 'opening', id: 'op_entrance' }, { kind: 'opening.place' });
    fireEvent.pointerDown(canvas);
    expect(screen.queryByText(/Проём: центр — двигать, края — ширина; Enter — готово/)).not.toBeNull();

    fireEvent.focusIn(field);
    expect(screen.queryByText(/центр — двигать, края — ширина/)).toBeNull();
    cleanup();
    document.body.replaceChildren();

    // Под «Проёмом» ручек зоны нет — и строки о них нет.
    const other = page();
    show({ kind: 'zone', id: 'z_hall' }, { kind: 'opening.place' });
    fireEvent.pointerDown(other.canvas);
    expect(screen.queryByText(/тяните вершину/)).toBeNull();
  });

  it('выбранный проём подсказывает, что Enter завершает его (D-267)', () => {
    const { canvas } = page();
    show({ kind: 'opening', id: 'op_entrance' });
    fireEvent.pointerDown(canvas);
    expect(screen.getByText(/центр — двигать, края — ширина/)).toBeDefined();
    expect(screen.getByText(/Enter — готово/)).toBeDefined();
  });

  it('подсказка инструмента «Проём» называет подготовку и применение', () => {
    show(null);
    const title = screen.getByRole('button', { name: 'Проём' }).getAttribute('title') ?? '';
    expect(title).toContain('Установить проём');
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
