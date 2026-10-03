// @vitest-environment jsdom
/**
 * C01/U07: сворачивание длинных списков «Справочника» — те же правила, что и
 * в «Инвентаризации» (первые три, «Показать все (N)»/«Свернуть»), тем же
 * `.panel__group` для разделения типов оборудования, типов зон и правил
 * (запрос пользователя 22.09).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { Catalog, PlanDocument, Result } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { CatalogPanel, type CatalogSection } from './CatalogPanel';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const parsed = parsePlanDocument(nested);
if (!parsed.ok) throw new Error('nested.json не разобрался');
const basePlan: PlanDocument = parsed.value;

/**
 * Пять типов оборудования, пять типов зон, пять правил — больше предела в
 * три, чтобы проверить сворачивание всех трёх списков одним планом. Данные
 * синтетические, только для этого теста.
 */
function manyPlan(): PlanDocument {
  const letters = ['c', 'd', 'e'] as const;
  const extraObjectTypes = letters.map((letter) => ({
    id: `ot_${letter}`,
    label: `Тип ${letter.toUpperCase()}`,
    category: 'Тест',
    defaultSize_m: [0.5, 0.5] as [number, number],
    defaultHeight_m: 0.5,
    defaultBase_m: 0,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect' as const,
    color: '#000000',
    attributes: [],
    provenance: 'Тестовые данные пакета справочника (сворачивание списков).',
  }));
  const extraZoneTypes = ['d', 'e'].map((letter) => ({
    id: `zt_${letter}`,
    label: `Зона ${letter.toUpperCase()}`,
    color: '#ffffff',
    attributes: [],
  }));
  const extraRules = ['b', 'c', 'd', 'e'].map((letter) => ({
    id: `rule_${letter}`,
    source: 'team-assumption' as const,
    rationale: 'Тестовое правило.',
    kind: 'count' as const,
    zoneTypeId: 'zt_client',
    objectTypeId: 'ot_workplace',
    scope: 'direct' as const,
    min: 0,
    max: null,
  }));
  const catalog: Catalog = {
    ...basePlan.catalog,
    objectTypes: [...basePlan.catalog.objectTypes, ...extraObjectTypes],
    zoneTypes: [...basePlan.catalog.zoneTypes, ...extraZoneTypes],
    rules: [...basePlan.catalog.rules, ...extraRules],
  };
  return { ...basePlan, catalog };
}

function renderPanel(plan: PlanDocument, section: CatalogSection) {
  const onCommand = vi.fn(() => ({ ok: true, value: plan }) as Result<PlanDocument>);
  const view = render(<CatalogPanel document={plan} onCommand={onCommand} section={section} />);
  return { onCommand, view };
}

/** Видимые строки списка — без скрытых атрибутом `hidden`. */
function visible(testId: string): HTMLElement[] {
  return [...screen.getByTestId(testId).querySelectorAll('li')].filter(
    (item) => !(item as HTMLLIElement).hidden,
  );
}

describe('сворачивание списков справочника', () => {
  test('по умолчанию видны первые три записи каждого списка, дальше — кнопка с числом', () => {
    const { view } = renderPanel(manyPlan(), 'objects');
    expect(screen.getByTestId('catalog-types').querySelectorAll('li')).toHaveLength(5);
    expect(visible('catalog-types')).toHaveLength(3);
    expect(screen.getByTestId('catalog-types-toggle').textContent).toBe('Показать все (5)');
    expect(screen.getByTestId('catalog-types-toggle').getAttribute('aria-expanded')).toBe('false');

    view.rerender(<CatalogPanel document={manyPlan()} onCommand={vi.fn()} section="zones" />);
    expect(visible('catalog-zone-types')).toHaveLength(3);
    expect(screen.getByTestId('catalog-zone-types-toggle').textContent).toBe('Показать все (5)');

    view.rerender(<CatalogPanel document={manyPlan()} onCommand={vi.fn()} section="rules" />);
    expect(visible('catalog-rules')).toHaveLength(3);
    expect(screen.getByTestId('catalog-rules-toggle').textContent).toBe('Показать все (5)');
  });

  test('«Показать все» раскрывает список типов, «Свернуть» возвращает обратно', () => {
    renderPanel(manyPlan(), 'objects');

    fireEvent.click(screen.getByTestId('catalog-types-toggle'));
    expect(visible('catalog-types')).toHaveLength(5);
    expect(screen.getByTestId('catalog-types-toggle').textContent).toBe('Свернуть');
    expect(screen.getByTestId('catalog-types-toggle').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('catalog-types-toggle'));
    expect(visible('catalog-types')).toHaveLength(3);
  });

  test('до трёх записей в списке — кнопки «Показать все» нет', () => {
    // nested.json без изменений: 2 типа оборудования, 3 типа зон, 1 правило —
    // ни один список не превышает предел.
    for (const [section, toggle] of [
      ['objects', 'catalog-types-toggle'],
      ['zones', 'catalog-zone-types-toggle'],
      ['rules', 'catalog-rules-toggle'],
    ] as const) {
      renderPanel(basePlan, section);
      expect(screen.queryByTestId(toggle)).toBeNull();
      cleanup();
    }
  });

  test('добавление нового типа раскрывает список типов, а не только счётчик в заголовке', () => {
    const plan = manyPlan();
    renderPanel(plan, 'objects');

    expect(screen.getByTestId('catalog-types-toggle').getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(screen.getByTestId('catalog-type-label'), { target: { value: 'Новый тип' } });
    fireEvent.click(screen.getByTestId('catalog-add-type'));

    // Отклик формы не ждёт нового документа в пропсах: раскрытие — состояние
    // экрана, оно переключается сразу же, как только команда принята.
    expect(screen.getByTestId('catalog-types-toggle').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('разделы окна «Настройки» (D-350)', () => {
  test('каждый раздел показывает только свою группу справочника', () => {
    const { view } = renderPanel(manyPlan(), 'objects');
    expect(screen.getByRole('region', { name: 'Типы оборудования' })).toBeTruthy();
    expect(screen.getByTestId('catalog-types')).toBeTruthy();
    expect(screen.queryByTestId('catalog-zone-types')).toBeNull();
    expect(screen.queryByTestId('catalog-rules')).toBeNull();

    view.rerender(<CatalogPanel document={manyPlan()} onCommand={vi.fn()} section="rules" />);
    expect(screen.getByRole('region', { name: 'Правила комплектования' })).toBeTruthy();
    expect(screen.getByTestId('catalog-rules')).toBeTruthy();
    expect(screen.queryByTestId('catalog-types')).toBeNull();
  });

  test('форма атрибутов в разделе зон — только для выбранного типа зоны', () => {
    renderPanel(manyPlan(), 'zones');
    expect(screen.queryByTestId('catalog-attributes')).toBeNull();
    const first = basePlan.catalog.zoneTypes[0]!;
    fireEvent.click(screen.getByRole('button', { name: first.label }));
    expect(screen.getByTestId('catalog-attributes').textContent).toContain(`Атрибуты типа зоны «${first.label}»`);
  });
});
