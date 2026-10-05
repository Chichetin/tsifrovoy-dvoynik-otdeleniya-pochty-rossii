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
import before from '../../../demo/before.json';
import minimal from '../../contracts/fixtures/minimal.json';
import nested from '../../contracts/fixtures/nested.json';
import type { Command } from '../../contracts/commands';
import type { PlanDocument, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { CommandSink, EditorSession } from '../../contracts/ui';
import { applyCommand } from '../../domain/commands';
import { PropertiesPanel } from './PropertiesPanel';

afterEach(cleanup);

test.each([undefined,null,'not-in-palette'])('карточка состояния использует defaultValue, не первый вариант (%s)',(value)=>{
  const document=structuredClone(demoPlan);
  const object=document.objects[0]!;
  const representation=document.catalog.layerTypes.find(type=>type.representation.kind==='object-color')!.representation;
  if(representation.kind!=='object-color')throw new Error('нет цветового слоя');
  representation.values.sort((a,b)=>Number(b.value==='working')-Number(a.value==='working'));
  representation.defaultValue='unknown';
  if(value===undefined)delete object.attributes[representation.attribute];
  else object.attributes[representation.attribute]=value;
  const before=structuredClone(document);const onCommand=vi.fn(sink().spy);
  render(<PropertiesPanel document={document} session={session({kind:'object',id:object.id})} onCommand={onCommand}/>);
  expect((screen.getByRole('combobox',{name:'Состояние'}) as HTMLSelectElement).value).toBe('unknown');
  expect(document).toEqual(before);
  expect(onCommand).not.toHaveBeenCalled();
});

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan: PlanDocument = parsed.value;

const parsedDemo = parsePlanDocument(before);
if (!parsedDemo.ok) throw new Error('demo/before.json не разобрался');
const demoPlan: PlanDocument = parsedDemo.value;

const parsedNested = parsePlanDocument(nested);
if (!parsedNested.ok) throw new Error('nested.json не разобрался');
const nestedPlan: PlanDocument = parsedNested.value;

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

describe('заголовок карточки (D-272)', () => {
  test('у карточки нет своих заголовков вида «Свойства объекта» — единственный заголовок даёт полоса в App; имя региона «Свойства» остаётся', () => {
    const zone = plan.zones[0];
    const object = plan.objects[0];
    if (zone === undefined || object === undefined) throw new Error('в minimal.json нет зон или объектов');
    const picks: (Ref | null)[] = [
      { kind: 'room', id: plan.room.id },
      { kind: 'zone', id: zone.id },
      { kind: 'object', id: object.id },
      { kind: 'wall', id: 'w_north' },
      { kind: 'opening', id: 'op_entrance' },
      null,
    ];
    for (const pick of picks) {
      show(pick);
      expect(screen.getByRole('region', { name: 'Свойства' })).toBeTruthy();
      expect(screen.queryAllByRole('heading')).toHaveLength(0);
      expect(screen.queryByText(/^Свойства/)).toBeNull();
      cleanup();
    }
  });
});

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

  test('самопересечённый контур площади не получает — вместо числа сказано, почему (D-242)', () => {
    // «Бабочка»: половинки контура в формуле площади гасят друг друга, и
    // `polygonArea` отдала бы ровный «0,00 м²» — число, которого нет. Панель
    // площадей на таком контуре отказывается считать, карточка обязана
    // говорить то же самое.
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
    expect(text).toContain('Контур пересекает сам себя: площадь по нему не считается');
    expect(text).toContain('Вершин 4');
    expect(text).not.toContain('м²');
    expect(text).not.toContain('0,00');
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
describe('упрощённая карточка (D-278)', () => {
  test('блока «Идентификатор» нет ни у одного вида сущности, id остаётся только атрибутом карточки', () => {
    const picks: Ref[] = [
      { kind: 'room', id: plan.room.id },
      { kind: 'zone', id: 'z_client' },
      { kind: 'object', id: 'eq_work_1' },
      { kind: 'wall', id: 'w_north' },
      { kind: 'opening', id: 'op_entrance' },
    ];
    for (const pick of picks) {
      show(pick);
      const card = screen.getByLabelText('Свойства');
      expect(card.getAttribute('data-entity-id')).toBe(pick.id);
      expect(card.textContent).not.toContain('Идентификатор');
      expect(card.textContent).not.toContain('не меняется');
      expect(screen.queryByTestId('props-id')).toBeNull();
      cleanup();
    }
  });

  test('зона объекта названа по имени зоны, без id и без «пересчитывается по геометрии»', () => {
    show({ kind: 'object', id: 'eq_work_1' });

    expect(screen.getByTestId('props-zone').textContent).toBe('Зона: Клиентская зона');
  });

  test('зона без имени (пустое или из пробелов) названа своим id, а не пустой строкой', () => {
    for (const name of ['', '   ']) {
      const unnamed: PlanDocument = {
        ...plan,
        zones: plan.zones.map((zone) => (zone.id === 'z_client' ? { ...zone, name } : zone)),
      };
      render(
        <PropertiesPanel
          document={unnamed}
          session={session({ kind: 'object', id: 'eq_work_1' })}
          onCommand={sink().spy}
        />,
      );
      expect(screen.getByTestId('props-zone').textContent).toBe('Зона: z_client');
      cleanup();
    }
  });

  test('висячая ссылка на несуществующую зону — «Зона: вне зон»', () => {
    const dangling: PlanDocument = {
      ...plan,
      objects: plan.objects.map((item) => (item.id === 'eq_work_1' ? { ...item, zoneId: 'z_missing' } : item)),
    };
    render(
      <PropertiesPanel
        document={dangling}
        session={session({ kind: 'object', id: 'eq_work_1' })}
        onCommand={sink().spy}
      />,
    );

    expect(screen.getByTestId('props-zone').textContent).toBe('Зона: вне зон');
  });

  test('объект вне зон — «Зона: вне зон»', () => {
    const outside: PlanDocument = {
      ...plan,
      objects: plan.objects.map((item) => (item.id === 'eq_work_1' ? { ...item, zoneId: null } : item)),
    };
    render(
      <PropertiesPanel
        document={outside}
        session={session({ kind: 'object', id: 'eq_work_1' })}
        onCommand={sink().spy}
      />,
    );

    expect(screen.getByTestId('props-zone').textContent).toBe('Зона: вне зон');
  });
});

describe('карточка перегородки', () => {
  test('выбранная перегородка показывает свою карточку, а не пустое состояние', () => {
    show({ kind: 'wall', id: 'w_north' });

    expect(screen.getByLabelText('Толщина, м')).toBeTruthy();
    expect(screen.getByLabelText('Свойства').getAttribute('data-entity-id')).toBe('w_north');
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

    expect(screen.getByLabelText('Вид')).toBeTruthy();
    expect(screen.getByLabelText('Свойства').getAttribute('data-entity-id')).toBe('op_entrance');
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

describe('смена типа зоны всегда переименовывает её в название типа', () => {
  /** Живая карточка на `nested.json`: там три типа зон, между которыми есть что переключать. */
  function LiveNested({ selection }: { selection: Ref | null }): React.JSX.Element {
    const [document, setDocument] = useState(nestedPlan);
    const onCommand: CommandSink = (command) => {
      const result = applyCommand(document, command);
      if (result.ok) setDocument(result.value);
      return result;
    };
    return <PropertiesPanel document={document} session={session(selection)} onCommand={onCommand} />;
  }

  test('название становится названием выбранного типа', () => {
    render(<LiveNested selection={{ kind: 'zone', id: 'z_service' }} />);

    fireEvent.change(screen.getByLabelText('Тип зоны'), { target: { value: 'zt_waiting' } });

    expect(screen.getByLabelText<HTMLInputElement>('Название').value).toBe('Зона ожидания');
    expect(screen.getByLabelText<HTMLSelectElement>('Тип зоны').value).toBe('zt_waiting');
  });

  test('правка названия тип не трогает — связь односторонняя', () => {
    render(<LiveNested selection={{ kind: 'zone', id: 'z_service' }} />);

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Склад посылок' } });

    expect(screen.getByLabelText<HTMLSelectElement>('Тип зоны').value).toBe('zt_service');
    expect(screen.getByLabelText<HTMLInputElement>('Название').value).toBe('Склад посылок');
  });

  test('введённое руками название смена типа заменяет (D-265)', () => {
    render(<LiveNested selection={{ kind: 'zone', id: 'z_service' }} />);

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Операционный зал' } });
    fireEvent.change(screen.getByLabelText('Тип зоны'), { target: { value: 'zt_waiting' } });

    expect(screen.getByLabelText<HTMLSelectElement>('Тип зоны').value).toBe('zt_waiting');
    expect(screen.getByLabelText<HTMLInputElement>('Название').value).toBe('Зона ожидания');
  });

  test('автоматическое имя новой зоны «Зона N» заменяется названием типа', () => {
    const { spy, commands } = sink();
    const document: PlanDocument = {
      ...nestedPlan,
      zones: nestedPlan.zones.map((zone) => (zone.id === 'z_service' ? { ...zone, name: 'Зона 4' } : zone)),
    };
    render(<PropertiesPanel document={document} session={session({ kind: 'zone', id: 'z_service' })} onCommand={spy} />);

    fireEvent.change(screen.getByLabelText('Тип зоны'), { target: { value: 'zt_client' } });

    const [command] = commands;
    if (command?.type !== 'zone.put') throw new Error('ожидалась команда zone.put');
    expect(command.zone.name).toBe('Клиентская зона');
  });

  test('пустое название заменяется названием типа', () => {
    const { spy, commands } = sink();
    const document: PlanDocument = {
      ...nestedPlan,
      zones: nestedPlan.zones.map((zone) => (zone.id === 'z_service' ? { ...zone, name: '  ' } : zone)),
    };
    render(<PropertiesPanel document={document} session={session({ kind: 'zone', id: 'z_service' })} onCommand={spy} />);

    fireEvent.change(screen.getByLabelText('Тип зоны'), { target: { value: 'zt_waiting' } });

    const [command] = commands;
    if (command?.type !== 'zone.put') throw new Error('ожидалась команда zone.put');
    expect(command.zone.name).toBe('Зона ожидания');
  });

  test('название, совпадающее с подписью другого типа, заменяется подписью нового', () => {
    const { spy, commands } = sink();
    const document: PlanDocument = {
      ...nestedPlan,
      zones: nestedPlan.zones.map((zone) => (zone.id === 'z_service' ? { ...zone, name: 'Клиентская зона' } : zone)),
    };
    render(<PropertiesPanel document={document} session={session({ kind: 'zone', id: 'z_service' })} onCommand={spy} />);

    fireEvent.change(screen.getByLabelText('Тип зоны'), { target: { value: 'zt_waiting' } });

    const [command] = commands;
    if (command?.type !== 'zone.put') throw new Error('ожидалась команда zone.put');
    expect(command.zone.typeId).toBe('zt_waiting');
    expect(command.zone.name).toBe('Зона ожидания');
  });

  test('тип и имя меняются одной командой — одно «Отменить» вернёт оба', () => {
    const { spy, commands } = sink();
    render(
      <PropertiesPanel
        document={nestedPlan}
        session={session({ kind: 'zone', id: 'z_service' })}
        onCommand={spy}
      />,
    );

    fireEvent.change(screen.getByLabelText('Тип зоны'), { target: { value: 'zt_waiting' } });

    expect(commands).toHaveLength(1);
    const [command] = commands;
    if (command?.type !== 'zone.put') throw new Error('ожидалась команда zone.put');
    expect(command.zone.typeId).toBe('zt_waiting');
    expect(command.zone.name).toBe('Зона ожидания');
  });
});

describe('атрибуты информационных слоёв без пометки условности — запрет участника (D-281)', () => {
  const hintOf = (label: string): string | null => {
    const input = screen.getByLabelText(label);
    const field = input.closest('label');
    return field?.querySelector('.props__hint')?.textContent ?? null;
  };

  const showZone = (): void => {
    const zone = demoPlan.zones.find((item) => item.attributes['loadPercent'] !== undefined);
    if (zone === undefined) throw new Error('в demo/before.json нет зоны с загрузкой');
    render(
      <PropertiesPanel
        document={demoPlan}
        session={session({ kind: 'zone', id: zone.id })}
        onCommand={sink().spy}
      />,
    );
  };

  test('границы чисел видны, пометка условности отсутствует', () => {
    showZone();
    expect(hintOf('Загрузка зоны, %')).toBe('Допустимо от 0 до 100');
    expect(hintOf('Сотрудников в смене')).toBe('Допустимо не меньше 0');
    expect(hintOf('Открыта для клиентов')).toBeNull();
    expect(document.body.textContent).not.toContain('не измерение');
  });
});
