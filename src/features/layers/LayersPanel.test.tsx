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
    expect(heat.getByRole('button', { name: 'Поднять слой Тепловая нагрузка зон' }).getAttribute('title')).toBe('Поднять слой');
    expect(heat.getByRole('button', { name: 'Опустить слой Тепловая нагрузка зон' }).getAttribute('title')).toBe('Опустить слой');
  });

  test('удаление не переносит содержимое в информационный или запертый слой', () => {
    const document = demo();
    document.layers = document.layers.map((layer) =>
      layer.typeId === null ? { ...layer, locked: true } : layer,
    );
    renderPanel(document);

    const remove = within(item('Тепловая нагрузка зон')).getByRole('button', {
      name: 'Удалить слой Тепловая нагрузка зон',
    });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
  });

  test('у включённого теплового слоя легенда: шкала, 0 … max, порог, «синтетические»', () => {
    renderPanel(demo(['l_lt_heat']));
    const legend = within(item('Тепловая нагрузка зон')).getByRole('group', {
      name: 'Легенда слоя Тепловая нагрузка зон',
    });
    // Единица через неразрывный пробел: «100 %» не разрывается строкой (D-197).
    expect(legend.textContent).toContain('0\u00a0%');
    expect(legend.textContent).toContain('100\u00a0%');
    expect(legend.textContent).toContain('от 100\u00a0% и выше');
    expect(legend.textContent).toContain('числа синтетические');
    const bar = legend.querySelector('.layers__scale') as HTMLElement;
    expect(bar.style.background).toContain('linear-gradient');
  });

  test('у выключенного информационного слоя легенды нет, у обычного — никогда', () => {
    renderPanel(demo(['l_lt_staff']));
    // Раскрытие «Что показывает слой» — тоже group, поэтому легенду ищем по имени.
    expect(within(item('Тепловая нагрузка зон')).queryByRole('group', { name: /^Легенда/ })).toBeNull();
    expect(within(item('Основной')).queryByRole('group')).toBeNull();
    const staff = within(item('Сотрудники по зонам')).getByRole('group', {
      name: 'Легенда слоя Сотрудники по зонам',
    });
    expect(staff.textContent).toContain('чел.');
  });

  test('карточка информационного слоя компактна: пояснение свёрнуто, «числа синтетические» видно всегда', () => {
    renderPanel(demo());
    const heat = item('Тепловая нагрузка зон');
    // Слой выключен, легенды нет, но строка об источнике чисел на виду.
    expect(heat.querySelector('.layers__meta')?.textContent).toContain('числа синтетические');
    const about = heat.querySelector('details');
    expect(about).not.toBeNull();
    expect(about?.open).toBe(false);
    expect(about?.querySelector('summary')?.textContent).toBe('Что показывает слой');
    // Полный текст справочника не потерян — он внутри раскрытия.
    expect(about?.textContent).toContain('Числа синтетические: загрузка зоны');
    expect(about?.textContent).toContain('поверх всего плана');
  });

  test('у включённого слоя «числа синтетические» говорит легенда, строка не дублирует её', () => {
    renderPanel(demo(['l_lt_heat']));
    const heat = item('Тепловая нагрузка зон');
    expect(heat.querySelector('.layers__meta')).toBeNull();
    const legend = within(heat).getByRole('group', { name: 'Легенда слоя Тепловая нагрузка зон' });
    expect(legend.textContent).toContain('числа синтетические');
  });

  test('обычный слой пояснения не прячет: зоны и объекты видны строкой', () => {
    renderPanel(demo());
    const main = item('Основной');
    expect(main.querySelector('details')).toBeNull();
    expect(main.querySelector('.layers__meta')?.textContent).toMatch(/^обычный слой · зон \d+, объектов \d+$/);
  });

  test('действия слоя — SVG-значки без эмодзи, скрытые от чтения с экрана, у кнопки есть имя', () => {
    const document = demo();
    document.layers = document.layers.map((layer) =>
      layer.typeId === 'lt_heat' ? { ...layer, locked: true } : layer,
    );
    renderPanel(document);
    for (const name of ['Тепловая нагрузка зон', 'Основной']) {
      const layer = within(item(name));
      for (const label of ['Запереть слой', 'Поднять слой', 'Опустить слой', 'Удалить слой']) {
        const button = layer.getByRole('button', { name: `${label} ${name}` });
        expect(button.textContent).toBe('');
        const icon = button.querySelector('svg');
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
        expect(icon?.getAttribute('focusable')).toBe('false');
      }
    }
    const lockOf = (name: string) =>
      within(item(name)).getByRole('button', { name: `Запереть слой ${name}` });
    expect(lockOf('Тепловая нагрузка зон').getAttribute('aria-pressed')).toBe('true');
    expect(lockOf('Тепловая нагрузка зон').querySelector('svg')?.dataset['icon']).toBe('lock');
    expect(lockOf('Основной').querySelector('svg')?.dataset['icon']).toBe('unlock');
  });

  test('кнопка добавления называется полностью, хотя на ней короткая подпись', () => {
    renderPanel(demo());
    const add = screen.getByRole('button', { name: 'Добавить слой' });
    expect(add.textContent).toBe('Добавить');
  });
});
