// @vitest-environment jsdom
/**
 * U05-ux: панель слоёв читается без догадок.
 *
 * Видимость — настоящий чекбокс с подписью; имя слоя не теряется при узкой
 * панели (полное имя в подсказке); у включённого информационного слоя есть
 * легенда из справочника.
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

function renderPanel(plan: PlanDocument, mode: 'view' | 'setup' = 'view') {
  const commands: Command[] = [];
  const onCommand = vi.fn((command: Command): Result<PlanDocument> => {
    commands.push(command);
    return { ok: true, value: plan };
  });
  render(<LayersPanel document={plan} session={session} onCommand={onCommand} onSelect={vi.fn()} mode={mode} />);
  return commands;
}

/** Row of the «Настройки» section: found by the name field, which only that mode has. */
const setupItem = (name: string): HTMLElement => {
  const li = screen.getByLabelText(`Имя слоя ${name}`).closest('li');
  if (li === null) throw new Error(name);
  return li;
};

const item = (name: string): HTMLElement => {
  const visible = screen.getByRole('button', { name: `Показывать слой ${name}` });
  const li = visible.closest('li');
  if (li === null) throw new Error(name);
  return li;
};

describe('LayersPanel', () => {
  test('значки объектов выключаются в панели и ничего не пишут в план', () => {
    const plan = demo();
    const commands: Command[] = [];
    const onToggle = vi.fn();
    render(
      <LayersPanel
        document={plan}
        session={session}
        onCommand={vi.fn((command: Command): Result<PlanDocument> => {
          commands.push(command);
          return { ok: true, value: plan };
        })}
        onSelect={vi.fn()}
        pictograms={{ shown: true, onToggle }}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Показывать значки объектов' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // Вид, а не документ: команда не уходит, отмена о переключателе не знает.
    expect(commands).toHaveLength(0);
  });

  test('без переключателя вида панель остаётся прежней', () => {
    renderPanel(demo());
    expect(screen.queryByRole('button', { name: 'Показывать значки объектов' })).toBeNull();
  });

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
    renderPanel(demo(), 'setup');
    expect(screen.getByLabelText('Имя слоя Тепловая нагрузка зон').getAttribute('title')).toBe('Тепловая нагрузка зон');
  });

  test('кнопки замка, порядка и удаления подписаны не только значком', () => {
    renderPanel(demo());
    expect(
      within(item('Тепловая нагрузка зон')).getByRole('button', { name: 'Запереть слой Тепловая нагрузка зон' }).getAttribute('title'),
    ).toBeTruthy();
    cleanup();
    renderPanel(demo(), 'setup');
    const heat = within(setupItem('Тепловая нагрузка зон'));
    expect(heat.getByRole('button', { name: 'Поднять слой Тепловая нагрузка зон' }).getAttribute('title')).toBe('Поднять слой');
    expect(heat.getByRole('button', { name: 'Опустить слой Тепловая нагрузка зон' }).getAttribute('title')).toBe('Опустить слой');
  });

  test('удаление не переносит содержимое в информационный или запертый слой', () => {
    const document = demo();
    document.layers = document.layers.map((layer) =>
      layer.typeId === null ? { ...layer, locked: true } : layer,
    );
    renderPanel(document, 'setup');

    const remove = within(setupItem('Тепловая нагрузка зон')).getByRole('button', {
      name: 'Удалить слой Тепловая нагрузка зон',
    });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
  });

  test('у включённого теплового слоя легенда: шкала, 0 … max, порог', () => {
    renderPanel(demo(['l_lt_heat']));
    const legend = within(item('Тепловая нагрузка зон')).getByRole('group', {
      name: 'Легенда слоя Тепловая нагрузка зон',
    });
    // Единица через неразрывный пробел: «100 %» не разрывается строкой (D-197).
    expect(legend.textContent).toContain('0\u00a0%');
    expect(legend.textContent).toContain('100\u00a0%');
    expect(legend.textContent).toContain('от 100\u00a0% и выше');
    const bar = legend.querySelector('.layers__scale') as HTMLElement;
    expect(bar.style.background).toContain('linear-gradient');
  });

  test('пометки условности у слоя нет и не будет — запрет участника (D-281)', () => {
    renderPanel(demo(['l_lt_heat']));
    const heat = item('Тепловая нагрузка зон');
    expect(heat.querySelector('.layers__caution')).toBeNull();
    expect(heat.textContent).not.toContain('Числа условные');
  });

  test('слой камер (D-307): покрытие по каждой клиентской зоне и итог, штриховка слепых пятен в легенде', () => {
    const plan = demo(['l_lt_cameras']);
    const onSelect = vi.fn();
    render(<LayersPanel document={plan} session={session} onCommand={vi.fn()} onSelect={onSelect} />);
    const cameras = within(item('Камеры и зоны обзора'));
    const group = cameras.getByRole('group', { name: 'Покрытие клиентских зон, слой Камеры и зоны обзора' });
    expect(group.textContent).toContain('слепые пятна клиентских зон');
    const swatch = group.querySelector('.layers__swatch') as HTMLElement;
    expect(swatch.style.background).toContain('repeating-linear-gradient');

    const table = within(group).getByRole('table', { name: 'Покрытие клиентских зон камерами' });
    const rows = within(table).getAllByRole('row').slice(1).map((row) => row.textContent);
    // Demo numbers fixed by camera-coverage.test.ts: 972 of 1036 squares seen.
    expect(rows).toEqual([
      'Клиентский зал93,8\u00a0%',
      'Входная группа99,4\u00a0%',
      'Зона ожидания95,9\u00a0%',
      'Зона очереди100\u00a0%',
      'Все клиентские зоны93,8\u00a0%',
    ]);
    // Service rooms are not client zones and are not listed.
    expect(table.textContent).not.toContain('Служебная зона');

    fireEvent.click(within(table).getByRole('button', { name: 'Зона очереди' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'zone', id: 'z_queue' });
    // No «conditional» caution in any wording (D-281).
    expect(group.textContent).not.toMatch(/условн|не измерение/i);
  });

  test('слой камер выключен — покрытия в панели нет; клиентских зон нет — сказано словами', () => {
    renderPanel(demo());
    expect(within(item('Камеры и зоны обзора')).queryByRole('table', { name: 'Покрытие клиентских зон камерами' })).toBeNull();
    cleanup();

    const base = demo(['l_lt_cameras']);
    renderPanel({ ...base, zones: base.zones.filter((zone) => zone.typeId === 'zt_service' || zone.typeId === 'zt_storage') });
    const cameras = within(item('Камеры и зоны обзора'));
    expect(cameras.queryByRole('table', { name: 'Покрытие клиентских зон камерами' })).toBeNull();
    expect(cameras.getByText('Клиентских зон на плане нет — покрытие считать не по чему')).toBeTruthy();
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

  test('карточка информационного слоя компактна: пояснение свёрнуто, строки меты нет', () => {
    renderPanel(demo());
    const heat = item('Тепловая нагрузка зон');
    // Слой выключен, легенды нет — и лишней строки под именем тоже нет, только раскрытие.
    expect(heat.querySelector('.layers__meta')).toBeNull();
    const about = heat.querySelector('details');
    expect(about).not.toBeNull();
    expect(about?.open).toBe(false);
    expect(about?.querySelector('summary')?.textContent).toBe('Что показывает слой');
    // Полный текст справочника не потерян — он внутри раскрытия.
    expect(about?.textContent).toContain('Загрузка зоны проставляется руками');
    expect(about?.textContent).toContain('поверх всего плана');
  });

  test('у включённого информационного слоя меты тоже нет: легенда говорит сама', () => {
    renderPanel(demo(['l_lt_heat']));
    const heat = item('Тепловая нагрузка зон');
    expect(heat.querySelector('.layers__meta')).toBeNull();
    const legend = within(heat).getByRole('group', { name: 'Легенда слоя Тепловая нагрузка зон' });
    expect(legend.textContent).not.toBe('');
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
    const checkIcons = (find: (name: string) => HTMLElement, labels: string[]): void => {
      for (const name of ['Тепловая нагрузка зон', 'Основной']) {
        const layer = within(find(name));
        for (const label of labels) {
          const button = layer.getByRole('button', { name: `${label} ${name}` });
          expect(button.textContent).toBe('');
          const icon = button.querySelector('svg');
          expect(icon?.getAttribute('aria-hidden')).toBe('true');
          expect(icon?.getAttribute('focusable')).toBe('false');
        }
      }
    };
    renderPanel(document);
    checkIcons(item, ['Запереть слой']);
    const lockOf = (name: string) =>
      within(item(name)).getByRole('button', { name: `Запереть слой ${name}` });
    expect(lockOf('Тепловая нагрузка зон').getAttribute('aria-pressed')).toBe('true');
    expect(lockOf('Тепловая нагрузка зон').querySelector('svg')?.dataset['icon']).toBe('lock');
    expect(lockOf('Основной').querySelector('svg')?.dataset['icon']).toBe('unlock');
    cleanup();
    renderPanel(document, 'setup');
    checkIcons(setupItem, ['Поднять слой', 'Опустить слой', 'Удалить слой']);
  });

  test('кнопка добавления называется полностью, хотя на ней короткая подпись', () => {
    renderPanel(demo(), 'setup');
    const add = screen.getByRole('button', { name: 'Добавить слой' });
    expect(add.textContent).toBe('Добавить');
  });

  test('D-275: под основным слоем — напольные и потолочные со счётом; щелчок не шлёт команду', () => {
    const plan = demo();
    const onToggle = vi.fn();
    const onCommand = vi.fn((): Result<PlanDocument> => ({ ok: true, value: plan }));
    render(
      <LayersPanel
        document={plan}
        session={session}
        onCommand={onCommand}
        onSelect={vi.fn()}
        objectMounts={{ layerId: 'l_base', hidden: new Set(['ceiling']), onToggle }}
      />,
    );
    const base = within(item('Основной'));
    const floor = base.getByRole('button', { name: 'Показывать: напольные объекты' });
    const ceiling = base.getByRole('button', { name: 'Показывать: потолочные объекты' });
    expect(floor.textContent).toContain('Напольные объекты (42)');
    expect(ceiling.textContent).toContain('Потолочные объекты (11)');
    expect(floor.getAttribute('aria-pressed')).toBe('true');
    expect(ceiling.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(ceiling);
    expect(onToggle).toHaveBeenCalledWith('ceiling');
    expect(onCommand).not.toHaveBeenCalled();
    // Only the base layer carries the groups.
    expect(within(item('Камеры и зоны обзора')).queryByText(/Напольные объекты/)).toBeNull();
  });

  test('D-275: основной слой скрыт — подпункты неактивны', () => {
    const plan = demo();
    const hiddenBase = {
      ...plan,
      layers: plan.layers.map((layer) => (layer.id === 'l_base' ? { ...layer, visible: false } : layer)),
    };
    render(
      <LayersPanel
        document={hiddenBase}
        session={session}
        onCommand={vi.fn()}
        onSelect={vi.fn()}
        objectMounts={{ layerId: 'l_base', hidden: new Set(), onToggle: vi.fn() }}
      />,
    );
    const base = within(item('Основной'));
    expect((base.getByRole('button', { name: 'Показывать: напольные объекты' }) as HTMLButtonElement).disabled).toBe(true);
    expect((base.getByRole('button', { name: 'Показывать: потолочные объекты' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
