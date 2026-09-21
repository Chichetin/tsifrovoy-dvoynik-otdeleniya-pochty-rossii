// @vitest-environment jsdom
/**
 * U03: что делает контроллер инструмента с законченным жестом рисования.
 *
 * Проверяется поведение, видимое снаружи: одна команда на замкнутый контур,
 * вложенность новой зоны по геометрии и отказ от самопересекающегося контура —
 * без обращения к Konva и без DOM плана.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../../contracts/commands';
import type { Catalog, PlanDocument, Point, Result } from '../../contracts/model';
import type { EditorSession, Tool, WorldPointer } from '../../contracts/ui';
import { applyCommand } from '../../domain/commands';
import { OUTER_OPENING_DROPPED_NOTICE, getNotice, setNotice } from './notice';
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

  it('удалённый в этой сессии id проёму не выдаётся: после «удалить op_1» новый — op_2', () => {
    const plan = planWith([]);
    plan.walls = [{ id: 'w_1', from: [0, 4], to: [10, 4], thickness_m: 0.2, height_m: 3 }];
    const { commands, click } = setup({ kind: 'opening.place' }, plan, new Set(['op_1']));
    click([5, 4]);
    const command = commands[0];
    if (command?.type !== 'opening.put') throw new Error('ожидалась opening.put');
    expect(command.opening.id).toBe('op_2');
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
    const { commands, click, plan } = setupApplying({ kind: 'room.draw' }, planWithEntrance());

    click([0, 0]);
    click([10, 0]);
    click([10, 8]);
    click([9, 8]);
    click([0.05, 0.05]);

    expect(commands).toHaveLength(1);
    expect(plan().openings).toHaveLength(0);
    expect(getNotice()).toBe(OUTER_OPENING_DROPPED_NOTICE);
  });

  it('контур, на котором вход уцелел, ничего не сообщает', () => {
    const { click, plan } = setupApplying({ kind: 'room.draw' }, planWithEntrance());

    click([0, 0]);
    click([14, 0]);
    click([14, 8]);
    click([0, 8]);
    click([0.05, 0.05]);

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
