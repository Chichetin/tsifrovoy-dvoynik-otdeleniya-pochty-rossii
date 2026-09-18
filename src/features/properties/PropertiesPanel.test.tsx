// @vitest-environment jsdom
/**
 * U06: карточка перегородки и проёма.
 *
 * Подсказка инструмента «Проём» обещает: «вид и размер правятся в карточке
 * свойств». Обещание должно выполняться — иначе толщину стены и ширину двери
 * в редакторе изменить нечем, а выбранная перегородка выглядит так, будто
 * выбора нет.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { Command } from '../../contracts/commands';
import type { PlanDocument, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { CommandSink, EditorSession } from '../../contracts/ui';
import { PropertiesPanel } from './PropertiesPanel';

afterEach(cleanup);

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan: PlanDocument = parsed.value;

const session = (selection: Ref | null): EditorSession => ({
  tool: { kind: 'select' },
  viewport: { origin: [0, 0], scale: 40 },
  selection,
  preview: null,
  focus: null,
});

/** Приёмник команд, который всегда соглашается и запоминает, что получил. */
function sink(): { spy: CommandSink; commands: Command[] } {
  const commands: Command[] = [];
  const spy: CommandSink = (command) => {
    commands.push(command);
    return { ok: true, value: plan };
  };
  return { spy, commands };
}

function show(selection: Ref | null, onCommand: CommandSink = sink().spy): void {
  render(<PropertiesPanel document={plan} session={session(selection)} onCommand={onCommand} />);
}

describe('карточка перегородки', () => {
  test('выбранная перегородка показывает свою карточку, а не пустое состояние', () => {
    show({ kind: 'wall', id: 'w_north' });

    expect(screen.getByText('Свойства перегородки')).toBeTruthy();
    expect(screen.getByTestId('props-id').textContent).toBe('w_north');
  });

  test('толщина и высота уходят командой wall.put', () => {
    const { spy, commands } = sink();
    show({ kind: 'wall', id: 'w_north' }, spy);

    fireEvent.change(screen.getByLabelText('Толщина, м'), { target: { value: '0.35' } });
    fireEvent.change(screen.getByLabelText('Высота, м'), { target: { value: '2.8' } });

    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({
      type: 'wall.put',
      wall: { ...plan.walls[0]!, thickness_m: 0.35 },
    });
    expect(commands[1]).toEqual({ type: 'wall.put', wall: { ...plan.walls[0]!, height_m: 2.8 } });
  });

  test('длина и концы показаны, но числами не правятся: геометрия живёт на плане', () => {
    show({ kind: 'wall', id: 'w_north' });

    // w_north идёт от (0; 8) до (10; 8) — длина 10 м.
    expect(screen.getByText(/Длина 10\.00 м/)).toBeTruthy();
    expect(screen.queryByLabelText('X, м')).toBeNull();
  });

  test('карточка говорит, сколько проёмов унесёт удаление стены', () => {
    show({ kind: 'wall', id: 'w_north' });

    expect(screen.getByText(/Проёмов на стене: 1/)).toBeTruthy();
  });

  test('нечисло в толщине не уходит командой и объясняется у поля', () => {
    const { spy, commands } = sink();
    show({ kind: 'wall', id: 'w_north' }, spy);

    fireEvent.change(screen.getByLabelText('Толщина, м'), { target: { value: 'толстая' } });

    expect(commands).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('число');
  });
});

describe('карточка проёма', () => {
  test('выбранный проём показывает свою карточку', () => {
    show({ kind: 'opening', id: 'op_entrance' });

    expect(screen.getByText('Свойства проёма')).toBeTruthy();
    expect(screen.getByTestId('props-id').textContent).toBe('op_entrance');
  });

  test('вид проёма меняется командой opening.put', () => {
    const { spy, commands } = sink();
    show({ kind: 'opening', id: 'op_entrance' }, spy);

    fireEvent.change(screen.getByLabelText('Вид'), { target: { value: 'window' } });

    expect(commands).toEqual([
      { type: 'opening.put', opening: { ...plan.openings[0]!, kind: 'window' } },
    ]);
  });

  test('ширина, отступ, порог и высота уходят командами', () => {
    const { spy, commands } = sink();
    show({ kind: 'opening', id: 'op_entrance' }, spy);

    fireEvent.change(screen.getByLabelText('Ширина, м'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Отступ от начала, м'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('От пола, м'), { target: { value: '0.9' } });
    fireEvent.change(screen.getByLabelText('Высота, м'), { target: { value: '1.4' } });

    expect(commands.map((command) => command.type)).toEqual([
      'opening.put',
      'opening.put',
      'opening.put',
      'opening.put',
    ]);
    expect(commands[0]).toEqual({
      type: 'opening.put',
      opening: { ...plan.openings[0]!, width_m: 1.5 },
    });
  });

  test('карточка называет стену, на которой стоит проём', () => {
    show({ kind: 'opening', id: 'op_entrance' });

    expect(screen.getByTestId('props-wall').textContent).toContain('w_north');
  });

  test('вид «вход» подписан связью с правилом про терминал', () => {
    show({ kind: 'opening', id: 'op_entrance' });

    expect(screen.getByText(/не далее 3 м от входа/)).toBeTruthy();
  });
});

describe('пустое состояние', () => {
  test('называет все четыре вида выбора, а не только два', () => {
    show(null);

    const empty = screen.getByText(/Выберите/).textContent ?? '';
    for (const word of ['зону', 'объект', 'перегородку', 'проём']) {
      expect(empty).toContain(word);
    }
  });

  test('ссылка на несуществующую стену не ломает карточку', () => {
    show({ kind: 'wall', id: 'w_gone' });

    expect(screen.getByText(/Выберите/)).toBeTruthy();
  });
});
