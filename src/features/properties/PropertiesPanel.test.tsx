// @vitest-environment jsdom
/**
 * U06: карточка перегородки и проёма.
 *
 * Подсказка инструмента «Проём» обещает: «вид и размер правятся в карточке
 * свойств». Обещание должно выполняться — иначе толщину стены и ширину двери
 * в редакторе изменить нечем, а выбранная перегородка выглядит так, будто
 * выбора нет.
 */

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { Command } from '../../contracts/commands';
import type { PlanDocument, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { CommandSink, EditorSession } from '../../contracts/ui';
import { applyCommand } from '../../domain/commands';
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

/** Живая карточка: команда применяется к плану, и панель перерисовывается, как в приложении. */
function Live({ selection }: { selection: Ref | null }): React.JSX.Element {
  const [document, setDocument] = useState(plan);
  const onCommand: CommandSink = (command) => {
    const result = applyCommand(document, command);
    if (result.ok) setDocument(result.value);
    return result;
  };
  return <PropertiesPanel document={document} session={session(selection)} onCommand={onCommand} />;
}

describe('карточка подъезжает к экрану', () => {
  test('переход из перечня или находок прокручивает карточку, повтор того же перехода — нет', () => {
    // jsdom не умеет прокрутку: подменяем и считаем вызовы.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const zone = plan.zones[0];
    if (zone === undefined) throw new Error('в minimal.json нет зон');
    const ref: Ref = { kind: 'zone', id: zone.id };
    const at = (sequence: number | null): EditorSession => ({
      ...session(ref),
      focus: sequence === null ? null : { ref, sequence },
    });
    const { rerender } = render(<PropertiesPanel document={plan} session={at(null)} onCommand={sink().spy} />);
    expect(scroll).not.toHaveBeenCalled();
    rerender(<PropertiesPanel document={plan} session={at(1)} onCommand={sink().spy} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<PropertiesPanel document={plan} session={at(1)} onCommand={sink().spy} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<PropertiesPanel document={plan} session={at(2)} onCommand={sink().spy} />);
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});

describe('карточка помещения', () => {
  test('площадь по контуру записана по-русски', () => {
    render(<Live selection={{ kind: 'room', id: plan.room.id }} />);
    expect(screen.getByTestId('props-room-area').textContent).toMatch(
      /^Площадь по контуру \d[\d\u00a0]*,\d\d\u00a0м², вершин \d+;/,
    );
  });

  test('самопересечённый контур площади не получает — вместо числа сказано, почему (D-233)', () => {
    // «Бабочка»: половинки контура в формуле площади гасят друг друга, и
    // `polygonArea` отдала бы ровный 0,00 м² — число, которого нет.
    const bowtie: PlanDocument = {
      ...plan,
      room: { ...plan.room, boundary: [[0, 0], [4, 0], [0, 4], [4, 4]] },
    };
    render(
      <PropertiesPanel
        document={bowtie}
        session={session({ kind: 'room', id: plan.room.id })}
        onCommand={sink().spy}
      />,
    );
    const text = screen.getByTestId('props-room-area').textContent ?? '';
    expect(text).toContain('Площадь не вычисляется: контур пересекает сам себя');
    expect(text).toContain('вершин 4');
    expect(text).not.toContain('м²');
  });

  test('название плана набирается посимвольно, пробел между словами не пропадает', () => {
    render(<Live selection={{ kind: 'room', id: plan.room.id }} />);
    const input = screen.getByLabelText('Название плана') as HTMLInputElement;
    for (const typed of ['О', 'ОП', 'ОПС', 'ОПС ', 'ОПС 7']) {
      fireEvent.change(input, { target: { value: typed } });
      expect(input.value).toBe(typed);
    }
  });

  test('отказ на пустом названии остаётся у поля помещения и не переезжает в карточку зоны', () => {
    const { rerender } = render(<Live selection={{ kind: 'room', id: plan.room.id }} />);
    fireEvent.change(screen.getByLabelText('Название плана'), { target: { value: '   ' } });
    expect(screen.getByRole('alert').textContent).toContain('название');

    const zone = plan.zones[0];
    if (zone === undefined) throw new Error('в minimal.json нет зон');
    rerender(<Live selection={{ kind: 'zone', id: zone.id }} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe(zone.name);
  });
});

describe('живые координаты объекта', () => {
  test('во время переноса меняет X/Y без команды и после жеста возвращается к документу', () => {
    const object = plan.objects[0];
    if (object === undefined) throw new Error('в minimal.json нет объекта');
    let preview: { objectId: string; position: [number, number] } | null = null;
    const listeners = new Set<() => void>();
    const channel = {
      getSnapshot: () => preview,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish: (next: typeof preview) => {
        preview = next;
        for (const listener of listeners) listener();
      },
    };
    const { spy, commands } = sink();

    render(
      <PropertiesPanel
        document={plan}
        session={session({ kind: 'object', id: object.id })}
        onCommand={spy}
        gesturePreview={channel}
      />,
    );

    expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe(String(object.position[0]));
    expect((screen.getByLabelText('Y, м') as HTMLInputElement).value).toBe(String(object.position[1]));

    act(() => channel.publish({ objectId: object.id, position: [6.25, 4.75] }));
    expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe('6.25');
    expect((screen.getByLabelText('Y, м') as HTMLInputElement).value).toBe('4.75');
    expect(commands).toEqual([]);

    act(() => channel.publish(null));
    expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe(String(object.position[0]));
    expect((screen.getByLabelText('Y, м') as HTMLInputElement).value).toBe(String(object.position[1]));
  });
});
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
    // Числа по-русски (D-197): запятая, «м» не отрывается от числа.
    // getByText схлопывает пробелы, поэтому неразрывный проверяется по textContent.
    const hint = screen.getByText(/Длина 10,00 м, от \(0,00; 8,00\) до \(10,00; 8,00\)/);
    expect(hint.textContent).toContain('10,00\u00a0м,');
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
    expect(screen.getByTestId('props-wall').textContent).toMatch(/длиной \d+,\d\d\u00a0м$/);
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
