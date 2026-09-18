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
import { getNotice, setNotice } from './notice';
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

function setup(tool: Tool, plan: PlanDocument) {
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
  };
  const hook = renderHook(() => usePlanToolController({ document: plan, session, onCommand }));
  const click = (point: Point): void => {
    act(() => hook.result.current.handlePointer(down(point)));
  };
  return { commands, hook, click };
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
