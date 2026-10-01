// @vitest-environment jsdom
/**
 * U03: что делает контроллер инструмента с законченным жестом рисования.
 *
 * Проверяется поведение, видимое снаружи: одна команда на замкнутый контур,
 * вложенность новой зоны по геометрии и отказ от самопересекающегося контура —
 * без обращения к Konva и без DOM плана.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../../contracts/commands';
import type { Catalog, PlanDocument, Point, Result } from '../../contracts/model';
import type { EditorSession, Tool, WorldPointer } from '../../contracts/ui';
import { applyCommand } from '../../domain/commands';
import {
  DRAFT_SELF_INTERSECTION_NOTICE,
  OUTER_OPENING_DROPPED_NOTICE,
  RING_TOO_FEW_POINTS_NOTICE,
  getNotice,
  setNotice,
} from './notice';
import { getMeasurement, setMeasurement } from './measure';
import { getSnapHint, setSnapHint } from './snap-marker';
import { usePlanToolController } from './use-plan-tool-controller';

const catalog: Catalog = {
  version: '1.0.0',
  objectTypes: [],
  zoneTypes: [{ id: 'zt_client', label: 'Клиентская зона', color: '#D0EBFF', attributes: [] }],
  layerTypes: [],
  rules: [],
};

function planWith(zones: PlanDocument['zones']): PlanDocument {
  return {
    schemaVersion: 1,
    id: 'plan_test',
    name: 'Тестовый план',
    room: {
      id: 'room_main',
      boundary: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      ceilingHeight_m: 3,
    },
    walls: [],
    openings: [],
    layers: [
      { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
      { id: 'l_heat', name: 'Нагрузка', visible: false, locked: false, order: 1, typeId: 'lt_heat' },
    ],
    zones,
    objects: [],
    catalog,
    extensions: {},
  };
}

const hall: PlanDocument['zones'][number] = {
  id: 'z_hall',
  typeId: 'zt_client',
  name: 'Клиентский зал',
  polygon: [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ],
  parentId: null,
  layerId: 'l_base',
  attributes: {},
};

function down(point: Point): WorldPointer {
  return { phase: 'down', point, shift: false, alt: false, button: 0 };
}

function setup(tool: Tool, plan: PlanDocument, retired: ReadonlySet<string> = new Set()) {
  const commands: Command[] = [];
  const onCommand = (command: Command): Result<PlanDocument> => {
    commands.push(command);
    return { ok: true, value: plan };
  };
  const session: EditorSession = {
    tool,
    viewport: { origin: [0, 0], scale: 50 },
    selection: null,
    preview: null,
    focus: null,
    retired,
  };
  const hook = renderHook(() => usePlanToolController({ document: plan, session, onCommand }));
  const click = (point: Point): void => {
    act(() => hook.result.current.handlePointer(down(point)));
  };
  return { commands, hook, click };
}

describe('явное завершение и исправление черновика', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());
  it('смена типа своей фигуры и повторное открытие документа сбрасывают углы', () => {
    const plan = planWith([]);
    const session: EditorSession = { tool: { kind: 'shape.draw', typeId: 'type-a' }, viewport: { origin: [0, 0], scale: 50 }, selection: null, preview: null, focus: null };
    const hook = renderHook(({ typeId, epoch }) => usePlanToolController({ document: plan, session: { ...session, tool: { kind: 'shape.draw', typeId } }, onCommand: () => ({ ok: true, value: plan }) }, epoch), { initialProps: { typeId: 'type-a', epoch: 0 } });
    act(() => hook.result.current.handlePointer(down([1, 1])));
    expect(hook.result.current.draft).toHaveLength(1);
    hook.rerender({ typeId: 'type-b', epoch: 0 });
    expect(hook.result.current.draft).toBeNull();
    act(() => hook.result.current.handlePointer(down([2, 2])));
    hook.rerender({ typeId: 'type-b', epoch: 1 });
    expect(hook.result.current.draft).toBeNull();
  });
  it('переименование плана во время рисования не сбрасывает углы', () => {
    const plan = planWith([]);
    const session: EditorSession = { tool: { kind: 'zone.draw' }, viewport: { origin: [0, 0], scale: 50 }, selection: null, preview: null, focus: null };
    const hook = renderHook(
      (document: PlanDocument) => usePlanToolController({ document, session, onCommand: () => ({ ok: true, value: document }) }),
      { initialProps: plan },
    );
    act(() => hook.result.current.handlePointer(down([1, 1])));
    act(() => hook.result.current.handlePointer(down([3, 1])));
    expect(hook.result.current.draft).toHaveLength(2);
    hook.rerender({ ...plan, name: 'Переименованный план' });
    expect(hook.result.current.draft).toHaveLength(2);
  });

  it('кнопка завершения использует прежнюю проверку и одну команду', () => {
    const { hook, click, commands } = setup({ kind: 'zone.draw' }, planWith([]));
    click([1, 1]); click([3, 1]);
    act(() => hook.result.current.finish());
    expect(commands).toHaveLength(0);
    expect(hook.result.current.draft).toHaveLength(2);
    click([3, 3]);
    act(() => hook.result.current.finish());
    expect(commands).toHaveLength(1);
    expect(hook.result.current.draft).toBeNull();
    act(() => hook.result.current.finish());
    expect(commands).toHaveLength(1);
  });

  it('самопересечение исправляется возвратом шага без команды', () => {
    const { hook, click, commands } = setup({ kind: 'zone.draw' }, planWith([]));
    click([1, 1]); click([3, 1]); click([1, 3]); click([3, 3]);
    act(() => hook.result.current.finish());
    expect(commands).toHaveLength(0);
    expect(getNotice()).toBe(DRAFT_SELF_INTERSECTION_NOTICE);
    act(() => hook.result.current.removeLast());
    expect(hook.result.current.draft).toHaveLength(3);
    expect(getNotice()).toBeNull();
    act(() => hook.result.current.finish());
    expect(commands).toHaveLength(1);
  });

  it('возврат последнего угла до пустого черновика снимает и курсор рисования', () => {
    const { hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    click([1, 1]);
    act(() =>
      hook.result.current.handlePointer({ phase: 'move', point: [2, 2], shift: false, alt: false, button: 0 }),
    );
    expect(hook.result.current.cursor).not.toBeNull();
    act(() => hook.result.current.removeLast());
    expect(hook.result.current.draft).toBeNull();
    expect(hook.result.current.cursor).toBeNull();
  });

  it('Backspace убирает угол и не доходит до удаления выбранного объекта', () => {
    const { hook, click, commands } = setup({ kind: 'zone.draw' }, planWith([]));
    click([1, 1]); click([3, 1]);
    let deletes = 0;
    const deleteListener = () => { deletes += 1; };
    window.addEventListener('keydown', deleteListener);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true })));
    window.removeEventListener('keydown', deleteListener);
    expect(deletes).toBe(0);
    expect(commands).toHaveLength(0);
    expect(hook.result.current.draft).toHaveLength(1);
    window.addEventListener('keydown', deleteListener);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', repeat: true, cancelable: true })));
    window.removeEventListener('keydown', deleteListener);
    expect(deletes).toBe(0);
    expect(hook.result.current.draft).toHaveLength(1);
    act(() => hook.result.current.removeLast());
    expect(hook.result.current.draft).toBeNull();
    window.addEventListener('keydown', deleteListener);
    const event = new KeyboardEvent('keydown', { key: 'Backspace', repeat: true, cancelable: true });
    act(() => window.dispatchEvent(event));
    window.removeEventListener('keydown', deleteListener);
    // Черновика больше нет: Backspace принадлежит выделению, а не рисованию.
    expect(deletes).toBe(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('регрессия: инструмент «Зона» вооружён, но угла ещё нет — Backspace удаляет выделение', () => {
    const { hook } = setup({ kind: 'zone.draw' }, planWith([]));
    expect(hook.result.current.draft).toBeNull();
    let deletes = 0;
    const deleteListener = () => {
      deletes += 1;
    };
    window.addEventListener('keydown', deleteListener);
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    act(() => window.dispatchEvent(event));
    window.removeEventListener('keydown', deleteListener);
    expect(deletes).toBe(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('отказ store сохраняет контур для исправления', () => {
    const plan = planWith([]);
    const session: EditorSession = { tool: { kind: 'zone.draw' }, viewport: { origin: [0, 0], scale: 50 }, selection: null, preview: null, focus: null };
    const hook = renderHook(() => usePlanToolController({ document: plan, session, onCommand: () => ({ ok: false, issues: [{ code: 'locked', severity: 'error', message: 'Слой заперт', refs: [] }] }) }));
    for (const point of [[1, 1], [3, 1], [3, 3]] as Point[]) act(() => hook.result.current.handlePointer(down(point)));
    act(() => hook.result.current.finish());
    expect(hook.result.current.draft).toHaveLength(3);
    act(() => hook.result.current.cancel());
    expect(hook.result.current.draft).toBeNull();
  });
});

/** Тот же стенд, но команда действительно применяется к плану. */
function setupApplying(tool: Tool, plan: PlanDocument) {
  const commands: Command[] = [];
  let current = plan;
  const onCommand = (command: Command): Result<PlanDocument> => {
    commands.push(command);
    const result = applyCommand(current, command);
    if (result.ok) current = result.value;
    return result;
  };
  const session: EditorSession = {
    tool,
    viewport: { origin: [0, 0], scale: 50 },
    selection: null,
    preview: null,
    focus: null,
  };
  const hook = renderHook(() => usePlanToolController({ document: plan, session, onCommand }));
  const click = (point: Point): void => {
    act(() => hook.result.current.handlePointer(down(point)));
  };
  return { commands, hook, click, plan: () => current };
}

/** План с одной северной стеной и входом в ней — единственным входом ОПС. */
function planWithEntrance(): PlanDocument {
  return {
    ...planWith([]),
    walls: [{ id: 'w_north', from: [0, 8], to: [10, 8], thickness_m: 0.2, height_m: 3 }],
    openings: [
      {
        id: 'op_entrance',
        wallId: 'w_north',
        offset_m: 4,
        width_m: 1.2,
        kind: 'entrance',
        sill_m: 0,
        height_m: 2.1,
      },
    ],
  };
}

beforeEach(() => setNotice(null));

describe('рисование контура', () => {
  it('замыкает зону кликом по первой точке и шлёт одну команду', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));

    click([1, 1]);
    click([3, 1]);
    click([3, 3]);
    expect(hook.result.current.draft).toHaveLength(3);

    click([1.1, 1.1]);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command?.type).toBe('zone.put');
    if (command?.type !== 'zone.put') throw new Error('ожидалась zone.put');
    expect(command.zone.polygon).toEqual([
      [1, 1],
      [3, 1],
      [3, 3],
    ]);
    expect(command.zone.layerId).toBe('l_base');
    // Жест закончен: черновика больше нет, повторный клик не шлёт вторую команду.
    expect(hook.result.current.draft).toBeNull();
  });

  it('удалённый в этой сессии id зоне не выдаётся: после «удалить z_1» новая — z_2', () => {
    const { commands, click } = setup({ kind: 'zone.draw' }, planWith([]), new Set(['z_1']));
    click([1, 1]);
    click([3, 1]);
    click([3, 3]);
    click([1.1, 1.1]);
    const command = commands[0];
    if (command?.type !== 'zone.put') throw new Error('ожидалась zone.put');
    expect(command.zone.id).toBe('z_2');
  });

  it('рисование контуров не ставит проём немедленно: им управляет отдельный предпросмотр', () => {
    const {commands,click}=setup({kind:'opening.place'},planWith([]));
    click([5,4]);expect(commands).toHaveLength(0);
  });

  it('зона, нарисованная внутри другой, становится вложенной', () => {
    const { commands, click } = setup({ kind: 'zone.draw' }, planWith([hall]));

    click([1, 1]);
    click([3, 1]);
    click([3, 3]);
    click([1, 1]);

    const command = commands[0];
    if (command?.type !== 'zone.put') throw new Error('ожидалась zone.put');
    expect(command.zone.parentId).toBe('z_hall');
  });

  it('все обычные слои заперты: зона адресуется запертому слою, а не информационному — store откажет с объяснением', () => {
    const document = planWith([]);
    document.layers = document.layers.map((layer) =>
      layer.typeId === null ? { ...layer, locked: true } : layer,
    );
    const { commands, click } = setup({ kind: 'zone.draw' }, document);

    click([1, 1]);
    click([3, 1]);
    click([3, 3]);
    click([1, 1]);

    // Команда уходит: молчание — не исход. Слой — запертый обычный `l_base`,
    // не информационный `l_heat` (D-174); отказ «слой заперт» даёт store.
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command?.type !== 'zone.put') throw new Error('ожидалась zone.put');
    expect(command.zone.layerId).toBe('l_base');
  });

  it('контур через границу зоны остаётся самостоятельной зоной', () => {
    const { commands, click } = setup({ kind: 'zone.draw' }, planWith([hall]));

    click([7, 1]);
    click([9.5, 1]);
    click([9.5, 3]);
    click([7, 1]);

    const command = commands[0];
    if (command?.type !== 'zone.put') throw new Error('ожидалась zone.put');
    expect(command.zone.parentId).toBeNull();
  });

  it('самопересекающийся контур не уходит в команду и объясняет отказ', () => {
    const { commands, hook, click } = setup({ kind: 'room.draw' }, planWith([]));

    click([0, 0]);
    click([4, 0]);
    click([0, 4]);
    click([4, 4]);
    click([0.1, 0.1]);

    expect(commands).toHaveLength(0);
    expect(getNotice()).toContain('самопересекается');
    // Черновик остаётся: нарисованное не выбрасывается из-за одной точки.
    expect(hook.result.current.draft).toHaveLength(4);
  });

  it('граница помещения уходит одной командой room.set', () => {
    const { commands, click } = setup({ kind: 'room.draw' }, planWith([]));

    click([0, 0]);
    click([5, 0]);
    click([5, 4]);
    click([0, 4]);
    click([0.05, 0.05]);

    expect(commands).toEqual([
      {
        type: 'room.set',
        boundary: [
          [0, 0],
          [5, 0],
          [5, 4],
          [0, 4],
        ],
      },
    ]);
  });

  it('пропавший при правке контура проём объясняется строкой, а не молчанием', () => {
    // Настоящая команда: новый контур пересобирает наружные стены, и вход не
    // помещается на новое северное ребро длиной 1 м.
    const { commands, hook, click, plan } = setupApplying({ kind: 'room.draw' }, planWithEntrance());

    click([0, 0]);
    click([10, 0]);
    click([10, 8]);
    click([9, 8]);
    click([0.05, 0.05]);

    expect(commands).toHaveLength(0);
    expect(plan().openings).toHaveLength(1);
    expect(hook.result.current.pendingRoom).toBe(true);
    act(() => hook.result.current.confirmRoom());
    expect(commands).toHaveLength(1);
    expect(plan().openings).toHaveLength(0);
    expect(getNotice()).toBe(OUTER_OPENING_DROPPED_NOTICE);
  });

  it('контур, на котором вход уцелел, ничего не сообщает', () => {
    const { hook, click, plan } = setupApplying({ kind: 'room.draw' }, planWithEntrance());

    click([0, 0]);
    click([14, 0]);
    click([14, 8]);
    click([0, 8]);
    click([0.05, 0.05]);

    act(() => hook.result.current.confirmRoom());
    expect(plan().openings).toHaveLength(1);
    expect(getNotice()).toBeNull();
  });

  it('Escape бросает черновик и ничего не меняет в плане', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));

    click([1, 1]);
    click([3, 1]);
    act(() => hook.result.current.handlePointer({ ...down([0, 0]), phase: 'cancel' }));

    expect(hook.result.current.draft).toBeNull();
    expect(commands).toEqual([]);
  });

  it('инструмент выбора не рисует', () => {
    const { commands, hook, click } = setup({ kind: 'select' }, planWith([]));
    click([1, 1]);
    expect(hook.result.current.draft).toBeNull();
    expect(commands).toEqual([]);
  });
});

/**
 * D-224: маркер цели привязки. Проверяется то, что видит рисующий: под
 * курсором названа цель каждой оси, `Alt` её убирает, а в документ и историю
 * маркер не попадает ни одним кадром.
 */
describe('маркер цели привязки', () => {
  function move(point: Point, alt = false): WorldPointer {
    return { phase: 'move', point, shift: false, alt, button: 0 };
  }

  function hover(hook: ReturnType<typeof setup>['hook'], point: Point, alt = false): void {
    act(() => hook.result.current.handlePointer(move(point, alt)));
  }

  beforeEach(() => setSnapHint(null));

  it('цель называется по осям порознь: по X вершина зоны, по Y узел сетки', () => {
    const { hook, commands } = setup({ kind: 'zone.draw' }, planWith([hall]));
    // Масштаб 50 px/м: допуск 8 px = 0,16 м. X = 7,9 в 0,1 от правой границы
    // зоны (8), Y = 3,1 в 0,1 от узла сетки 3,0 и далеко от границ зоны.
    hover(hook, [7.9, 3.1]);

    expect(getSnapHint()?.x?.target).toBe('zone');
    expect(getSnapHint()?.y?.target).toBe('grid');
    expect(getSnapHint()?.point).toEqual([8, 3]);
    // Ни один кадр движения не стал командой: маркер — подсказка, не правка.
    expect(commands).toEqual([]);
    expect(hook.result.current.draft).toBeNull();
  });

  it('точка, обещанная маркером, и точка клика — одна и та же', () => {
    const { hook, commands } = setup({ kind: 'zone.draw' }, planWith([hall]));
    hover(hook, [7.9, 3.1]);
    const promised = getSnapHint()?.point;

    act(() => hook.result.current.handlePointer(down([7.9, 3.1])));
    expect(hook.result.current.draft).toEqual([promised]);
    expect(commands).toEqual([]);
  });

  it('с Alt маркера нет — как нет и привязки', () => {
    const { hook } = setup({ kind: 'zone.draw' }, planWith([hall]));
    hover(hook, [7.9, 3.1]);
    expect(getSnapHint()).not.toBeNull();

    hover(hook, [7.9, 3.1], true);
    expect(getSnapHint()).toBeNull();
  });

  it('вдали от всего маркера нет', () => {
    const { hook } = setup({ kind: 'zone.draw' }, planWith([hall]));
    // 2,25 — между узлами сетки 2,0 и 2,5, до границ зоны метры.
    hover(hook, [2.25, 2.25]);
    expect(getSnapHint()).toBeNull();
  });

  it('проём привязке не подлежит — и маркера ему не показывают', () => {
    const { hook } = setup({ kind: 'opening.place' }, planWithEntrance());
    hover(hook, [4, 7.9]);
    expect(getSnapHint()).toBeNull();
  });

  it('инструмент «Выбор» маркера не показывает', () => {
    const { hook } = setup({ kind: 'select' }, planWith([hall]));
    hover(hook, [7.9, 3.1]);
    expect(getSnapHint()).toBeNull();
  });

  it('сменили инструмент — маркер снят', () => {
    const plan = planWith([hall]);
    const session = (tool: Tool): EditorSession => ({
      tool,
      viewport: { origin: [0, 0], scale: 50 },
      selection: null,
      preview: null,
      focus: null,
    });
    const hook = renderHook(
      (tool: Tool) =>
        usePlanToolController({ document: plan, session: session(tool), onCommand: () => ({ ok: true, value: plan }) }),
      { initialProps: { kind: 'zone.draw' } as Tool },
    );
    act(() => hook.result.current.handlePointer(move([7.9, 3.1])));
    expect(getSnapHint()).not.toBeNull();

    hook.rerender({ kind: 'select' });
    expect(getSnapHint()).toBeNull();
  });

  it('Escape и замкнутый контур снимают маркер', () => {
    const { hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    hover(hook, [7.9, 3.1]);
    act(() => hook.result.current.handlePointer({ ...down([0, 0]), phase: 'cancel' }));
    expect(getSnapHint()).toBeNull();

    click([1, 1]);
    click([3, 1]);
    click([3, 3]);
    hover(hook, [1.05, 1.05]);
    expect(getSnapHint()).not.toBeNull();
    click([1.05, 1.05]);
    expect(getSnapHint()).toBeNull();
  });
});

/**
 * D-256: линейка меряет расстояние и ничего не меняет в плане. Два клика —
 * измерение, третий начинает новое, Escape убирает; точки садятся туда же,
 * куда их сажает рисование.
 */
describe('линейка', () => {
  function move(point: Point, alt = false): WorldPointer {
    return { phase: 'move', point, shift: false, alt, button: 0 };
  }

  beforeEach(() => setMeasurement(null));
  afterEach(() => setMeasurement(null));

  it('первый клик начинает измерение, второй его заканчивает', () => {
    const { click } = setup({ kind: 'measure' }, planWith([]));
    click([1, 1]);
    expect(getMeasurement()).toEqual({ from: [1, 1], to: [1, 1], fixed: false });

    click([4, 5]);
    expect(getMeasurement()).toEqual({ from: [1, 1], to: [4, 5], fixed: true });
  });

  it('до первого клика на холсте ничего не меряется', () => {
    const { hook } = setup({ kind: 'measure' }, planWith([]));
    act(() => hook.result.current.handlePointer(move([3, 3])));
    expect(getMeasurement()).toBeNull();
  });

  it('пока измерение не закончено, второй конец идёт за курсором', () => {
    const { hook, click } = setup({ kind: 'measure' }, planWith([]));
    click([1, 1]);
    act(() => hook.result.current.handlePointer(move([2.5, 1])));
    expect(getMeasurement()?.to).toEqual([2.5, 1]);
    expect(getMeasurement()?.fixed).toBe(false);
  });

  it('законченное измерение за курсором не бегает', () => {
    const { hook, click } = setup({ kind: 'measure' }, planWith([]));
    click([1, 1]);
    click([3, 1]);
    act(() => hook.result.current.handlePointer(move([7, 7])));
    expect(getMeasurement()?.to).toEqual([3, 1]);
  });

  it('третий клик начинает новое измерение с чистого листа', () => {
    const { click } = setup({ kind: 'measure' }, planWith([]));
    click([1, 1]);
    click([3, 1]);
    click([6, 2]);
    expect(getMeasurement()).toEqual({ from: [6, 2], to: [6, 2], fixed: false });
  });

  it('Escape убирает измерение с холста', () => {
    const { hook, click } = setup({ kind: 'measure' }, planWith([]));
    click([1, 1]);
    click([3, 1]);
    act(() => hook.result.current.handlePointer({ ...down([0, 0]), phase: 'cancel' }));
    expect(getMeasurement()).toBeNull();
  });

  it('смена инструмента убирает измерение: продолжать его больше нечем', () => {
    const plan = planWith([]);
    const session = (tool: Tool): EditorSession => ({
      tool,
      viewport: { origin: [0, 0], scale: 50 },
      selection: null,
      preview: null,
      focus: null,
    });
    const hook = renderHook(
      (tool: Tool) =>
        usePlanToolController({
          document: plan,
          session: session(tool),
          onCommand: () => ({ ok: true, value: plan }),
        }),
      { initialProps: { kind: 'measure' } as Tool },
    );
    act(() => hook.result.current.handlePointer(down([1, 1])));
    act(() => hook.result.current.handlePointer(down([3, 1])));
    expect(getMeasurement()).not.toBeNull();

    hook.rerender({ kind: 'select' });
    expect(getMeasurement()).toBeNull();
  });

  it('открыли другой план — измерение прежнего с холста уходит', () => {
    const plan = planWith([]);
    const session: EditorSession = {
      tool: { kind: 'measure' },
      viewport: { origin: [0, 0], scale: 50 },
      selection: null,
      preview: null,
      focus: null,
    };
    const hook = renderHook(
      (document: PlanDocument) =>
        usePlanToolController({ document, session, onCommand: () => ({ ok: true, value: document }) }),
      { initialProps: plan },
    );
    act(() => hook.result.current.handlePointer(down([1, 1])));
    act(() => hook.result.current.handlePointer(down([3, 1])));
    expect(getMeasurement()).not.toBeNull();

    // Правка того же плана измерение не трогает.
    hook.rerender({ ...plan, name: plan.name, zones: [hall] });
    expect(getMeasurement()).not.toBeNull();

    hook.rerender({ ...plan, id: 'plan_other', name: 'Другое отделение' });
    expect(getMeasurement()).toBeNull();
  });

  it('точки садятся по привязке, как у рисования: клик у вершины зоны берёт вершину', () => {
    // Масштаб 50 px/м, допуск 8 px = 0,16 м: клик в 0,1 м от угла зоны.
    const { click } = setup({ kind: 'measure' }, planWith([hall]));
    click([7.9, 0.05]);
    expect(getMeasurement()?.from).toEqual([8, 0]);
  });

  it('Alt выключает привязку и у линейки', () => {
    const { hook } = setup({ kind: 'measure' }, planWith([hall]));
    act(() => hook.result.current.handlePointer({ ...down([7.9, 0.05]), alt: true }));
    expect(getMeasurement()?.from).toEqual([7.9, 0.05]);
  });

  it('измерение не отправляет в план ни одной команды', () => {
    const { click, commands } = setup({ kind: 'measure' }, planWith([hall]));
    click([1, 1]);
    click([5, 5]);
    click([2, 2]);
    expect(commands).toEqual([]);
  });
});

describe('замыкание контура с клавиатуры и двойным кликом', () => {
  const square: Point[] = [
    [1, 1],
    [3, 1],
    [3, 3],
  ];

  function pressEnter(target: EventTarget = window, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  /** Холст Konva в DOM — контейнер `.konvajs-content`: двойной клик считается только по нему. */
  function canvasNode(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'konvajs-content';
    const canvas = document.createElement('canvas');
    content.append(canvas);
    document.body.append(content);
    return canvas;
  }

  function doubleClick(target: EventTarget): void {
    act(() => {
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
  }

  // Хуки прежних тестов остаются смонтированными со своими черновиками и
  // слушали бы тот же window: Enter здесь адресован только своему стенду.
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it('Enter при трёх точках шлёт ту же команду, что клик по первой точке', () => {
    const byClick = setup({ kind: 'zone.draw' }, planWith([]));
    for (const point of square) byClick.click(point);
    byClick.click([1.1, 1.1]);
    byClick.hook.unmount();

    const byEnter = setup({ kind: 'zone.draw' }, planWith([]));
    for (const point of square) byEnter.click(point);
    const event = pressEnter();

    expect(byEnter.commands).toEqual(byClick.commands);
    expect(byEnter.commands).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
    expect(byEnter.hook.result.current.draft).toBeNull();
    // Второй Enter ничего не шлёт: черновика больше нет.
    pressEnter();
    expect(byEnter.commands).toHaveLength(1);
  });

  it('Enter замыкает и границу помещения одной командой room.set', () => {
    const { commands, click } = setup({ kind: 'room.draw' }, planWith([]));
    for (const point of square) click(point);
    pressEnter();
    expect(commands).toEqual([{ type: 'room.set', boundary: square }]);
  });

  it('Enter при двух точках ничего не шлёт и объясняет почему', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    click([1, 1]);
    click([3, 1]);
    pressEnter();

    expect(commands).toEqual([]);
    expect(getNotice()).toBe(RING_TOO_FEW_POINTS_NOTICE);
    expect(hook.result.current.draft).toHaveLength(2);
  });

  it('Enter без черновика не перехватывается', () => {
    const { commands } = setup({ kind: 'zone.draw' }, planWith([]));
    const event = pressEnter();
    expect(commands).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(getNotice()).toBeNull();
  });

  it('самопересекающийся контур по Enter отклоняется тем же отказом', () => {
    const { commands, hook, click } = setup({ kind: 'room.draw' }, planWith([]));
    click([0, 0]);
    click([4, 0]);
    click([0, 4]);
    click([4, 4]);
    pressEnter();

    expect(commands).toHaveLength(0);
    expect(getNotice()).toBe(DRAFT_SELF_INTERSECTION_NOTICE);
    expect(hook.result.current.draft).toHaveLength(4);
  });

  it('Enter в поле ввода остаётся полю', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    for (const point of square) click(point);
    const input = document.createElement('input');
    document.body.append(input);
    const event = pressEnter(input);

    expect(commands).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(hook.result.current.draft).toHaveLength(3);
  });

  it('Enter у перегородки ничего не делает', () => {
    const { commands, hook, click } = setup({ kind: 'wall.draw' }, planWith([]));
    click([1, 1]);
    pressEnter();
    expect(commands).toEqual([]);
    expect(hook.result.current.draft).toHaveLength(1);
  });

  it('двойной клик ставит последнюю точку и замыкает без дубля вершины', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    const canvas = canvasNode();
    click([1, 1]);
    click([3, 1]);
    // Двойной клик: два обычных клика уже добавили по вершине, второй — почти там же.
    click([3, 3]);
    click([3.04, 3.03]);
    doubleClick(canvas);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command?.type !== 'zone.put') throw new Error('ожидалась zone.put');
    expect(command.zone.polygon).toEqual(square);
    expect(hook.result.current.draft).toBeNull();
  });

  it('двойной клик при недостатке точек оставляет черновик без дубля и объясняет', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    const canvas = canvasNode();
    click([1, 1]);
    click([3, 1]);
    click([3, 1]);
    doubleClick(canvas);

    expect(commands).toEqual([]);
    expect(getNotice()).toBe(RING_TOO_FEW_POINTS_NOTICE);
    expect(hook.result.current.draft).toEqual([
      [1, 1],
      [3, 1],
    ]);
  });

  it('двойной клик вне холста контур не замыкает', () => {
    const { commands, hook, click } = setup({ kind: 'zone.draw' }, planWith([]));
    for (const point of square) click(point);
    const button = document.createElement('button');
    document.body.append(button);
    doubleClick(button);

    expect(commands).toEqual([]);
    expect(hook.result.current.draft).toHaveLength(3);
  });

  it('двойной клик в режиме выбора ничего не рисует', () => {
    const { commands, hook } = setup({ kind: 'select' }, planWith([]));
    doubleClick(canvasNode());
    expect(commands).toEqual([]);
    expect(hook.result.current.draft).toBeNull();
  });
});

describe('«Своя фигура» (D-279)', () => {
  const desk = {
    id: 'ot_desk',
    label: 'Стол',
    category: 'Мебель',
    defaultSize_m: [1.2, 0.6] as Point,
    defaultHeight_m: 0.75,
    defaultBase_m: 0,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect' as const,
    color: '#4C6EF5',
    attributes: [],
    provenance: 'Допущение команды',
  };
  const withDesk = (): PlanDocument => ({ ...planWith([]), catalog: { ...catalog, objectTypes: [desk] } });

  it('замкнутый многоугольник становится объектом выбранного типа: габарит — рамка, центр — её середина', () => {
    const { commands, click, plan } = setupApplying({ kind: 'shape.draw', typeId: 'ot_desk' }, withDesk());
    click([1, 1]);
    click([4, 1]);
    click([4, 2]);
    click([2, 3]);
    click([1.05, 1.05]);
    expect(commands).toHaveLength(1);
    const placed = plan().objects[0];
    expect(placed).toMatchObject({ typeId: 'ot_desk', label: 'Стол', position: [2.5, 2], size_m: [3, 2], rotation_deg: 0 });
    expect(placed?.outline).toEqual([
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0],
      [-0.166667, 0.5],
    ]);
  });

  it('тип не найден в справочнике — объяснение, черновик на месте', () => {
    const { commands, hook, click } = setup({ kind: 'shape.draw', typeId: 'ot_missing' }, withDesk());
    click([1, 1]);
    click([4, 1]);
    click([4, 3]);
    click([1.05, 1.05]);
    expect(commands).toHaveLength(0);
    expect(getNotice()).toMatch(/выберите тип в библиотеке/);
    expect(hook.result.current.draft).toHaveLength(3);
  });
});


describe('замена существующих наружных стен', () => {
  it('Enter и повторное завершение не применяют контур без отдельного подтверждения', () => {
    const { hook, click, commands } = setup({ kind: 'room.draw' }, planWithEntrance());
    click([0, 0]); click([4, 0]); click([4, 4]); click([0, 4]);
    act(() => hook.result.current.finish());
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(commands).toHaveLength(0);
    expect(hook.result.current.pendingRoom).toBe(true);
    act(() => hook.result.current.cancel());
    act(() => hook.result.current.confirmRoom());
    expect(commands).toHaveLength(0);
    expect(hook.result.current.pendingRoom).toBe(false);
    expect(hook.result.current.draft).toBeNull();
  });
});
