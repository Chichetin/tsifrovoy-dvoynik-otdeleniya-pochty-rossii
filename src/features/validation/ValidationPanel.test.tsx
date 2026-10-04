// @vitest-environment jsdom
/**
 * V02: находка должна называть вещь, а не только её `id`.
 *
 * Список проверок читает тот, кто пойдёт двигать оборудование: «Скамья 1
 * пересекает Рабочее место 1» он поймёт, «eq_bench_1 / eq_work_1» — нет.
 * Технические идентификаторы доступны отдельно и не мешают читать список.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { FocusRequest } from '../../contracts/ui';
import type { Issue, PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { ValidationIssue } from '../../domain/validation';
import { RELATION_ISSUE_CODES, relationIssues } from '../../domain/relations';
import { ValidationPanel } from './ValidationPanel';

afterEach(cleanup);

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const plan: PlanDocument = parsed.value;

const collision: Issue = {
  code: 'OBJECTS_OVERLAP',
  severity: 'error',
  message: 'Объекты пересекаются',
  refs: [
    { kind: 'object', id: 'eq_bench_1' },
    { kind: 'zone', id: 'z_client' },
  ],
};

function renderPanel(issues: Issue[], document: PlanDocument | undefined) {
  const onFocus = vi.fn();
  render(<ValidationPanel issues={issues} document={document} onFocus={onFocus} />);
  return { onFocus };
}

describe('названия в находках', () => {
  test('по умолчанию видны названия, но не код и внутренние id', () => {
    renderPanel([collision], plan);
    const item = within(screen.getByRole('listitem'));

    expect(item.getByRole('button', { name: 'Скамья 1' })).not.toBeNull();
    expect(item.getByRole('button', { name: 'Клиентская зона' })).not.toBeNull();
    expect(item.queryByText('eq_bench_1')).toBeNull();
    expect(item.queryByText('z_client')).toBeNull();
    expect(screen.queryByText('OBJECTS_OVERLAP')).toBeNull();
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Показать технические детали',
    });
    expect(checkbox.checked).toBe(false);
  });

  test('флажок раскрывает код, ссылки, правила и путь', () => {
    const technical: ValidationIssue = {
      ...collision,
      path: '/objects/0/position',
      ruleIds: ['rule_bench_min'],
    };
    renderPanel([technical], plan);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Показать технические детали' }));

    expect(screen.getByText('OBJECTS_OVERLAP')).not.toBeNull();
    expect(screen.getByText('object:eq_bench_1')).not.toBeNull();
    expect(screen.getByText('zone:z_client')).not.toBeNull();
    expect(screen.getByText('rule_bench_min')).not.toBeNull();
    expect(screen.getByText('/objects/0/position')).not.toBeNull();
    expect(screen.getByLabelText('Технические детали находки').getAttribute('translate')).toBe('no');
  });

  test('клик по находке ведёт к тому, о чём она', () => {
    const { onFocus } = renderPanel([collision], plan);

    fireEvent.click(screen.getByRole('button', { name: 'Скамья 1' }));

    expect(onFocus).toHaveBeenCalledWith({ kind: 'object', id: 'eq_bench_1' });
  });

  test('id, которого в плане уже нет, показан как есть', () => {
    const ghost: Issue = { ...collision, refs: [{ kind: 'object', id: 'eq_ghost' }] };
    renderPanel([ghost], plan);

    expect(screen.getByRole('button', { name: 'eq_ghost' })).not.toBeNull();
  });

  test('известные стена и проём названы без raw id', () => {
    const infrastructure: Issue = {
      ...collision,
      refs: [
        { kind: 'wall', id: 'w_north' },
        { kind: 'opening', id: 'op_entrance' },
      ],
    };
    renderPanel([infrastructure], plan);

    expect(screen.getByRole('button', { name: 'Стена' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Главный вход' })).not.toBeNull();
    expect(screen.queryByText('w_north')).toBeNull();
    expect(screen.queryByText('op_entrance')).toBeNull();
  });

  test('реальная находка связи называет объект, а не его id', () => {
    const relocated: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object) =>
        object.id === 'eq_bench_1'
          ? { ...object, position: [9.5, 7.9], zoneId: null }
          : object,
      ),
    };
    const finding = relationIssues(relocated).find(
      (issue) => issue.code === RELATION_ISSUE_CODES.ZONE_UNASSIGNED,
    );
    if (finding === undefined) throw new Error('Ожидалась находка неназначенного объекта');

    renderPanel([finding], relocated);

    expect(screen.getByText('Объект «Скамья 1» не лежит целиком ни в одной зоне.')).not.toBeNull();
    expect(screen.queryByText(/eq_bench_1/)).toBeNull();
  });

  test('без документа панель показывает id и не ломается', () => {
    renderPanel([collision], undefined);

    expect(screen.getByRole('button', { name: 'eq_bench_1' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'z_client' })).not.toBeNull();
  });

  test('ошибки идут раньше предупреждений', () => {
    const warning: Issue = { ...collision, code: 'BENCH_MIN', severity: 'warning', refs: [] };
    renderPanel([warning, collision], plan);

    expect(screen.getAllByRole('listitem').map((item) => item.className)).toEqual([
      'issues__item is-error',
      'issues__item is-warning',
    ]);
  });

  test('нарушений нет — панель говорит об этом, а не показывает пустоту', () => {
    renderPanel([], plan);

    expect(screen.getByText('Нарушений не найдено')).not.toBeNull();
  });
});

describe('клик по маркеру на плане (V02-marker-click)', () => {
  const zoneOnly: Issue = {
    code: 'ZONE_RULE',
    severity: 'warning',
    message: 'Зоне не хватает оборудования',
    refs: [{ kind: 'zone', id: 'z_client' }],
  };

  test('без фокуса ни одна строка не выделена', () => {
    render(<ValidationPanel issues={[collision, zoneOnly]} document={plan} onFocus={vi.fn()} />);

    for (const item of screen.getAllByRole('listitem')) {
      expect(item.className.includes('is-focused')).toBe(false);
      expect(item.getAttribute('aria-current')).toBeNull();
    }
  });

  test('фокус на сущности выделяет её находки и не трогает чужие', () => {
    // jsdom не умеет прокрутку: подменяем, как в других тестах со scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    const focus: FocusRequest = { ref: { kind: 'object', id: 'eq_bench_1' }, sequence: 1 };
    render(<ValidationPanel issues={[collision, zoneOnly]} document={plan} onFocus={vi.fn()} focus={focus} />);

    const items = screen.getAllByRole('listitem');
    const [benchRow, zoneRow] = items;
    expect(benchRow?.className.includes('is-focused')).toBe(true);
    expect(benchRow?.getAttribute('aria-current')).toBe('true');
    expect(zoneRow?.className.includes('is-focused')).toBe(false);
    expect(zoneRow?.getAttribute('aria-current')).toBeNull();
  });

  test('прокручивает к первой находке; повтор того же клика не прокручивает снова', () => {
    // jsdom не умеет прокрутку: подменяем и считаем вызовы, как в PropertiesPanel.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const ref = { kind: 'object' as const, id: 'eq_bench_1' };
    const at = (sequence: number | null): FocusRequest | null => (sequence === null ? null : { ref, sequence });

    const { rerender } = render(
      <ValidationPanel issues={[collision, zoneOnly]} document={plan} onFocus={vi.fn()} focus={at(null)} />,
    );
    expect(scroll).not.toHaveBeenCalled();

    rerender(<ValidationPanel issues={[collision, zoneOnly]} document={plan} onFocus={vi.fn()} focus={at(1)} />);
    expect(scroll).toHaveBeenCalledTimes(1);

    rerender(<ValidationPanel issues={[collision, zoneOnly]} document={plan} onFocus={vi.fn()} focus={at(1)} />);
    expect(scroll).toHaveBeenCalledTimes(1);

    // Клик по тому же маркеру снова — новая последовательность, список подъезжает опять.
    rerender(<ValidationPanel issues={[collision, zoneOnly]} document={plan} onFocus={vi.fn()} focus={at(2)} />);
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});
