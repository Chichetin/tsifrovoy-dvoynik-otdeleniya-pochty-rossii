// @vitest-environment jsdom
/**
 * U05-ux: панель слоёв читается без догадок.
 *
 * Видимость — настоящий чекбокс с подписью; имя слоя не теряется при узкой
 * панели (полное имя в подсказке); у включённого информационного слоя есть
 * легенда из справочника и подпись «числа синтетические».
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import before from '../../../demo/before.json';
import type { Command } from '../../contracts/commands';
import type { PlanDocument, Result } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession } from '../../contracts/ui';
import { LayersPanel } from './LayersPanel';

afterEach(cleanup);

function demo(visible: string[] = []): PlanDocument {
  const parsed = parsePlanDocument(before);
  if (!parsed.ok) throw new Error('demo/before.json does not parse');
  return {
    ...parsed.value,
    layers: parsed.value.layers.map((layer) => ({
      ...layer,
      visible: layer.typeId === null || visible.includes(layer.id),
    })),
  };
}

const session: EditorSession = {
  tool: { kind: 'select' },
  viewport: { origin: [0, 0], scale: 48 },
  selection: null,
  preview: null,
  focus: null,
};

function renderPanel(plan: PlanDocument) {
  const commands: Command[] = [];
  const onCommand = vi.fn((command: Command): Result<PlanDocument> => {
    commands.push(command);
    return { ok: true, value: plan };
  });
  render(<LayersPanel document={plan} session={session} onCommand={onCommand} onSelect={vi.fn()} />);
  return commands;
}

const item = (name: string): HTMLElement => {
  const input = screen.getByLabelText(`Имя слоя ${name}`);
  const li = input.closest('li');
  if (li === null) throw new Error(name);
  return li;
};

describe('LayersPanel', () => {
  test('видимость — кнопка-флажок с подписью, щелчок переключает флаг слоя', () => {
    const commands = renderPanel(demo());
    const toggle = within(item('Тепловая нагрузка зон')).getByRole('button', {
      name: 'Показывать слой Тепловая нагрузка зон',
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toContain('Показывать');

    fireEvent.click(toggle);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command?.type).toBe('layer.put');
    if (command?.type !== 'layer.put') return;
    expect(command.layer).toMatchObject({ id: 'l_lt_heat', visible: true });
  });

  test('включённый обычный слой отмечен, выключение шлёт visible: false', () => {
    const commands = renderPanel(demo());
    const toggle = within(item('Основной')).getByRole('button', {
      name: 'Показывать слой Основной',
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    const command = commands[0];
    if (command?.type !== 'layer.put') throw new Error('layer.put expected');
    expect(command.layer.visible).toBe(false);
  });

  test('полное имя слоя доступно в подсказке, даже если строка узкая', () => {
    renderPanel(demo());
    expect(screen.getByLabelText('Имя слоя Тепловая нагрузка зон').getAttribute('title')).toBe('Тепловая нагрузка зон');
  });

  test('кнопки замка, порядка и удаления подписаны не только значком', () => {
    renderPanel(demo());
    const heat = within(item('Тепловая нагрузка зон'));
    expect(heat.getByRole('button', { name: 'Запереть слой Тепловая нагрузка зон' }).getAttribute('title')).toBeTruthy();
    expect(heat.getByRole('button', { name: 'Поднять слой Тепловая нагрузка зон' }).getAttribute('title')).toBe('Поднять');
    expect(heat.getByRole('button', { name: 'Опустить слой Тепловая нагрузка зон' }).getAttribute('title')).toBe('Опустить');
  });

  test('у включённого теплового слоя легенда: шкала, 0 … max, порог, «синтетические»', () => {
    renderPanel(demo(['l_lt_heat']));
    const legend = within(item('Тепловая нагрузка зон')).getByRole('group', {
      name: 'Легенда слоя Тепловая нагрузка зон',
    });
    expect(legend.textContent).toContain('0 %');
    expect(legend.textContent).toContain('100 %');
    expect(legend.textContent).toContain('от 100 % и выше');
    expect(legend.textContent).toContain('числа синтетические');
    const bar = legend.querySelector('.layers__scale') as HTMLElement;
    expect(bar.style.background).toContain('linear-gradient');
  });

  test('у выключенного информационного слоя легенды нет, у обычного — никогда', () => {
    renderPanel(demo(['l_lt_staff']));
    expect(within(item('Тепловая нагрузка зон')).queryByRole('group')).toBeNull();
    expect(within(item('Основной')).queryByRole('group')).toBeNull();
    const staff = within(item('Сотрудники по зонам')).getByRole('group', {
      name: 'Легенда слоя Сотрудники по зонам',
    });
    expect(staff.textContent).toContain('чел.');
  });
});
