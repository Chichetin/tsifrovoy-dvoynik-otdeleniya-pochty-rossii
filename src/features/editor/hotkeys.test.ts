// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../contracts/commands';
import type { Equipment, PlanDocument, Point, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { applyCommand } from '../../domain/commands';

import {
  DUPLICATE_OFFSET_M,
  type HotkeyAction,
  type HotkeyEvent,
  hotkeyAction,
  hotkeyCommand,
  isFitHotkey,
  isTypingTarget,
} from './hotkeys';

function event(patch: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return {
    code: 'KeyF',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...patch,
  };
}

describe('клавиша вписывания', () => {
  it('срабатывает на голую F', () => {
    expect(isFitHotkey(event())).toBe(true);
  });

  it('не зависит от раскладки: решает код клавиши, а не буква (D-128)', () => {
    // На русской раскладке та же физическая клавиша даёт «а»; кода это не меняет.
    expect(isFitHotkey(event({ code: 'KeyF' }))).toBe(true);
    expect(isFitHotkey(event({ code: 'KeyA' }))).toBe(false);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
  ])('не срабатывает с модификатором %s', (_name, patch) => {
    expect(isFitHotkey(event(patch))).toBe(false);
  });

  it('молчит, пока пользователь печатает', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isFitHotkey(event({ target: document.createElement(tag) }))).toBe(false);
    }
    // jsdom не реализует isContentEditable, поэтому свойство задано явно:
    // проверяем правило предиката, а не полноту среды.
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isFitHotkey(event({ target: editable }))).toBe(false);
  });

  it('обычный элемент полем ввода не считается', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// U02-keys: история, стрелки и дублирование (находка operator №18, D-179).

const minimal = loadPlan('minimal.json');
const OBJECT: Ref = { kind: 'object', id: 'eq_work_1' };

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.issues.map((issue) => issue.code).join(', ')}`);
  return parsed.value;
}

function key(code: string, patch: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return event({ code, ...patch });
}

function withObject(plan: PlanDocument, patch: Partial<Equipment>): PlanDocument {
  return {
    ...plan,
    objects: plan.objects.map((object) => (object.id === OBJECT.id ? { ...object, ...patch } : object)),
  };
}

function applied(plan: PlanDocument, command: Command | null): PlanDocument {
  if (command === null) throw new Error('команды нет');
  const result = applyCommand(plan, command);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('; '));
  return result.value;
}

describe('какая комбинация что делает', () => {
  it('F вписывает план', () => {
    expect(hotkeyAction(key('KeyF'))).toEqual({ kind: 'fit' });
  });

  it.each([
    ['Ctrl+Z', { ctrlKey: true }],
    ['Cmd+Z', { metaKey: true }],
  ])('%s — отмена', (_name, patch) => {
    expect(hotkeyAction(key('KeyZ', patch))).toEqual({ kind: 'undo' });
  });

  it.each([
    ['Ctrl+Shift+Z', 'KeyZ', { ctrlKey: true, shiftKey: true }],
    ['Cmd+Shift+Z', 'KeyZ', { metaKey: true, shiftKey: true }],
    ['Ctrl+Y', 'KeyY', { ctrlKey: true }],
  ])('%s — повтор', (_name, code, patch) => {
    expect(hotkeyAction(key(code, patch))).toEqual({ kind: 'redo' });
  });

  it('голые Z и Y — просто буквы, история их не слышит', () => {
    expect(hotkeyAction(key('KeyZ'))).toBeNull();
    expect(hotkeyAction(key('KeyY'))).toBeNull();
    expect(hotkeyAction(key('KeyZ', { shiftKey: true }))).toBeNull();
  });

  it('Alt меняет смысл сочетания: Ctrl+Alt+Z и Ctrl+Alt+D оставлены браузеру и ОС', () => {
    expect(hotkeyAction(key('KeyZ', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(hotkeyAction(key('KeyY', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(hotkeyAction(key('KeyD', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('Ctrl+D и Cmd+D дублируют, Ctrl+Shift+D — нет', () => {
    expect(hotkeyAction(key('KeyD', { ctrlKey: true }))).toEqual({ kind: 'duplicate' });
    expect(hotkeyAction(key('KeyD', { metaKey: true }))).toEqual({ kind: 'duplicate' });
    expect(hotkeyAction(key('KeyD', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(hotkeyAction(key('KeyD'))).toBeNull();
  });

  it('стрелки двигают на 0,1 м, а по экрану «вверх» — это +Y модели (D-010)', () => {
    expect(hotkeyAction(key('ArrowRight'))).toEqual({ kind: 'nudge', delta: [0.1, 0] });
    expect(hotkeyAction(key('ArrowLeft'))).toEqual({ kind: 'nudge', delta: [-0.1, 0] });
    expect(hotkeyAction(key('ArrowUp'))).toEqual({ kind: 'nudge', delta: [0, 0.1] });
    expect(hotkeyAction(key('ArrowDown'))).toEqual({ kind: 'nudge', delta: [0, -0.1] });
  });

  it('Shift+стрелка — шаг 1 м', () => {
    expect(hotkeyAction(key('ArrowRight', { shiftKey: true }))).toEqual({ kind: 'nudge', delta: [1, 0] });
    expect(hotkeyAction(key('ArrowDown', { shiftKey: true }))).toEqual({ kind: 'nudge', delta: [0, -1] });
  });

  it('Ctrl, Cmd и Alt со стрелкой — навигация браузера, не план', () => {
    expect(hotkeyAction(key('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(hotkeyAction(key('ArrowLeft', { metaKey: true }))).toBeNull();
    expect(hotkeyAction(key('ArrowLeft', { altKey: true }))).toBeNull();
  });

  it('браузерные Ctrl+F, Ctrl+C, Ctrl+V не перехватываются', () => {
    for (const code of ['KeyF', 'KeyC', 'KeyV', 'KeyA']) {
      expect(hotkeyAction(key(code, { ctrlKey: true }))).toBeNull();
      expect(hotkeyAction(key(code, { metaKey: true }))).toBeNull();
    }
  });

  it('в поле ввода не срабатывает ни одна клавиша: там свои отмена и стрелки', () => {
    const presses: HotkeyEvent[] = [
      key('KeyF'),
      key('KeyZ', { ctrlKey: true }),
      key('KeyZ', { ctrlKey: true, shiftKey: true }),
      key('KeyY', { ctrlKey: true }),
      key('KeyD', { ctrlKey: true }),
      key('ArrowUp'),
      key('ArrowLeft', { shiftKey: true }),
    ];
    for (const tag of ['input', 'textarea', 'select'] as const) {
      for (const press of presses) {
        expect(hotkeyAction({ ...press, target: document.createElement(tag) })).toBeNull();
      }
    }
  });
});

describe('команда по нажатию', () => {
  const nudge = (delta: Point): HotkeyAction => ({ kind: 'nudge', delta });

  it('без выбора или при выбранной зоне стрелки и Ctrl+D ничего не делают', () => {
    const retired = new Set<string>();
    expect(hotkeyCommand(nudge([0.1, 0]), minimal, null, retired)).toBeNull();
    expect(hotkeyCommand({ kind: 'duplicate' }, minimal, null, retired)).toBeNull();
    const zone: Ref = { kind: 'zone', id: 'z_client' };
    expect(hotkeyCommand(nudge([0.1, 0]), minimal, zone, retired)).toBeNull();
    expect(hotkeyCommand({ kind: 'duplicate' }, minimal, zone, retired)).toBeNull();
  });

  it('выбранный id, которого нет в плане, команды не даёт', () => {
    const ghost: Ref = { kind: 'object', id: 'eq_ghost' };
    expect(hotkeyCommand(nudge([0.1, 0]), minimal, ghost, new Set())).toBeNull();
  });

  it('история и вписывание — не команды документа', () => {
    for (const kind of ['undo', 'redo', 'fit'] as const) {
      expect(hotkeyCommand({ kind }, minimal, OBJECT, new Set())).toBeNull();
    }
  });

  it('стрелка — один object.put со сдвигом, остальное как было', () => {
    const command = hotkeyCommand(nudge([0.1, 0]), minimal, OBJECT, new Set());
    expect(command?.type).toBe('object.put');
    if (command?.type !== 'object.put') return;
    const before = minimal.objects[0]!;
    expect(command.object).toEqual({ ...before, position: [2.1, 2] });
  });

  it('сдвиг по Y и назад', () => {
    const up = hotkeyCommand(nudge([0, 1]), minimal, OBJECT, new Set());
    expect(up?.type === 'object.put' && up.object.position).toEqual([2, 3]);
    const down = hotkeyCommand(nudge([0, -0.1]), minimal, OBJECT, new Set());
    expect(down?.type === 'object.put' && down.object.position).toEqual([2, 1.9]);
  });

  it('координата округляется до сантиметра: десять шагов по 0,1 — ровно метр', () => {
    let plan = withObject(minimal, { position: [0.7, 0.3] });
    for (let step = 0; step < 10; step += 1) {
      plan = applied(plan, hotkeyCommand(nudge([0.1, 0]), plan, OBJECT, new Set()));
    }
    expect(plan.objects[0]!.position).toEqual([1.7, 0.3]);
  });

  it('объект, вышедший из зоны, теряет связь с ней, как при перетаскивании', () => {
    const plan = withObject(minimal, { position: [6.3, 2] });
    const moved = applied(plan, hotkeyCommand(nudge([1, 0]), plan, OBJECT, new Set()));
    expect(moved.objects[0]!.position).toEqual([7.3, 2]);
    expect(moved.objects[0]!.zoneId).toBeNull();
  });

  it('скрытый объект клавиатурой не двигается и не копируется', () => {
    const hidden = { ...minimal, layers: minimal.layers.map((layer) => ({ ...layer, visible: false })) };
    expect(hotkeyCommand(nudge([0.1, 0]), hidden, OBJECT, new Set())).toBeNull();
    expect(hotkeyCommand({ kind: 'duplicate' }, hidden, OBJECT, new Set())).toBeNull();
  });

  it('копия: тот же тип, размер, поворот, высоты и слой, сдвиг вправо-вниз, новый id', () => {
    const plan = withObject(minimal, { rotation_deg: 90 });
    const command = hotkeyCommand({ kind: 'duplicate' }, plan, OBJECT, new Set());
    expect(command?.type).toBe('object.put');
    if (command?.type !== 'object.put') return;
    const source = plan.objects[0]!;
    const copy = command.object;
    expect(copy.id).not.toBe(source.id);
    expect(copy.typeId).toBe(source.typeId);
    expect(copy.label).toBe(source.label);
    expect(copy.size_m).toEqual(source.size_m);
    expect(copy.rotation_deg).toBe(90);
    expect(copy.base_m).toBe(source.base_m);
    expect(copy.height_m).toBe(source.height_m);
    expect(copy.layerId).toBe(source.layerId);
    expect(copy.position).toEqual([
      source.position[0] + DUPLICATE_OFFSET_M[0],
      source.position[1] + DUPLICATE_OFFSET_M[1],
    ]);
    // Вправо-вниз на экране: +X и −Y модели.
    expect(DUPLICATE_OFFSET_M[0]).toBeGreaterThan(0);
    expect(DUPLICATE_OFFSET_M[1]).toBeLessThan(0);
  });

  it('копия не наследует инвентарный номер: атрибуты — по справочнику, как у нового', () => {
    const command = hotkeyCommand({ kind: 'duplicate' }, minimal, OBJECT, new Set());
    if (command?.type !== 'object.put') throw new Error('нет копии');
    expect(minimal.objects[0]!.attributes['inventoryNumber']).toBe('ОПС-0001');
    expect(command.object.attributes).toEqual({});
  });

  it('id копии не совпадает ни с одной сущностью плана и ни с удалённым в сессии (D-019)', () => {
    const plan = withObject(minimal, { id: 'eq_1' });
    const selected: Ref = { kind: 'object', id: 'eq_1' };
    // eq_2 занят зоной, eq_3 удалён в этой сессии — копия получает eq_4.
    const crowded = { ...plan, zones: plan.zones.map((zone) => ({ ...zone, id: 'eq_2' })) };
    const command = hotkeyCommand({ kind: 'duplicate' }, crowded, selected, new Set(['eq_3']));
    expect(command?.type === 'object.put' && command.object.id).toBe('eq_4');
  });

  it('копия проходит applyCommand и появляется в плане рядом с оригиналом', () => {
    const next = applied(minimal, hotkeyCommand({ kind: 'duplicate' }, minimal, OBJECT, new Set()));
    expect(next.objects).toHaveLength(minimal.objects.length + 1);
    expect(next.objects.find((object) => object.id === OBJECT.id)).toEqual(minimal.objects[0]);
  });
});
