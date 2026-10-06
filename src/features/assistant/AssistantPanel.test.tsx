// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { calculateAdvice, defaultExplanation } from '../../domain/advice';
import { AssistantPanel } from './AssistantPanel';
import { setDebugMode } from './debug-mode';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');

afterEach(() => {
  cleanup();
  setDebugMode(false);
});

function changedCatalog(plan: PlanDocument): PlanDocument {
  const source = plan.catalog.objectTypes[0];
  if (source === undefined) throw new Error('в minimal.json нет типов объектов');
  return {
    ...plan,
    zones: [],
    catalog: {
      ...plan.catalog,
      objectTypes: [{ ...source, id: 'ot_other', label: 'Другой тип' }],
      rules: [],
    },
  };
}

test('после открытия другого плана не отправляет тип и зону прежнего документа', () => {
  const onAsk = vi.fn();
  const props = {
    revision: 0,
    response: null,
    state: { status: 'idle' as const },
    onPreview: vi.fn(),
    onFocus: vi.fn(),
    onAsk,
  };
  const { rerender } = render(<AssistantPanel {...props} document={parsed.value} />);

  const oldZone = parsed.value.zones[0];
  if (oldZone === undefined) throw new Error('в minimal.json нет зон');
  fireEvent.change(screen.getByLabelText('Зона'), { target: { value: oldZone.id } });

  const next = changedCatalog(parsed.value);
  rerender(<AssistantPanel {...props} document={next} revision={1} />);

  expect((screen.getByLabelText('Объект') as HTMLSelectElement).value).toBe('ot_other');
  expect((screen.getByLabelText('Зона') as HTMLSelectElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Спросить' }));
  expect(onAsk).toHaveBeenCalledWith(
    { scenario: 'place', typeId: 'ot_other', zoneId: null },
    undefined,
  );
});

test('без типов оборудования объясняет причину и не отправляет пустой typeId', () => {
  const onAsk = vi.fn();
  const empty: PlanDocument = {
    ...parsed.value,
    catalog: { ...parsed.value.catalog, objectTypes: [], rules: [] },
  };
  render(
    <AssistantPanel
      document={empty}
      revision={0}
      response={null}
      state={{ status: 'idle' }}
      onPreview={vi.fn()}
      onFocus={vi.fn()}
      onAsk={onAsk}
    />,
  );

  expect(screen.getByRole('option', { name: 'Нет типов в справочнике' })).toBeDefined();
  expect(screen.getByText('Для поиска места сначала добавьте тип оборудования в справочник.')).toBeDefined();
  const ask = screen.getByRole('button', { name: 'Спросить' }) as HTMLButtonElement;
  expect(ask.disabled).toBe(true);
  fireEvent.click(ask);
  expect(onAsk).not.toHaveBeenCalled();
});

test('числа ответа записаны по-русски: запятая, единица через неразрывный пробел', () => {
  const calculated = calculateAdvice(parsed.value, {
    scenario: 'place',
    typeId: 'ot_workplace',
    zoneId: null,
  });
  if (!calculated.ok) throw new Error('расчёт не выполнился');
  const recommendations = calculated.value;
  expect(recommendations[0]?.candidates.length ?? 0).toBeGreaterThan(0);
  render(
    <AssistantPanel
      document={parsed.value}
      revision={0}
      response={{
        revision: 0,
        recommendations,
        explanations: recommendations
          .map((recommendation) => defaultExplanation(recommendation))
          .filter((explanation) => explanation !== null),
        mode: 'fallback',
        fallbackReason: 'проверка',
      }}
      state={{ status: 'done' }}
      onPreview={vi.fn()}
      onFocus={vi.fn()}
      onAsk={vi.fn()}
    />,
  );

  const panel = screen.getByLabelText('Ассистент');
  const facts = [...panel.querySelectorAll('.advice__facts b, .advice__forecast')].map(
    (node) => node.textContent ?? '',
  );
  const variants = [...panel.querySelectorAll('.advice__candidates li > span:first-child')].map(
    (node) => node.textContent ?? '',
  );
  expect(facts.length + variants.length).toBeGreaterThan(0);
  for (const text of [...facts, ...variants]) expect(text).not.toMatch(/\d\.\d/);
  expect(variants[0]).toMatch(/^Вариант 1: -?\d+,\d\d; -?\d+,\d\d\u00a0м, поворот \d+°$/);
  const areaFacts = [...panel.querySelectorAll('.advice__facts b')]
    .map((node) => node.textContent ?? '')
    .filter((text) => text.endsWith('м²'));
  for (const text of areaFacts) expect(text).toMatch(/^[+-]?\d[\d\u00a0]*,\d\d\u00a0м²$/);
});

test('#10: зона варианта, ссылки и изменения показывают названия, id — в title/data-ref-id и в видимом раскрытии «ID» (review !318)', () => {
  const zone = parsed.value.zones[0]!;
  const object = parsed.value.objects[0]!;
  const calculated = calculateAdvice(parsed.value, { scenario: 'place', typeId: 'ot_workplace', zoneId: null });
  if (!calculated.ok) throw new Error('расчёт не выполнился');
  const candidate = calculated.value[0]?.candidates[0];
  if (candidate === undefined) throw new Error('в minimal.json не нашлось варианта места');
  const recommendation = {
    ...calculated.value[0]!,
    // A recommendation the calculation would build, but with a change and a
    // ref added by hand: real data to check the panel, not the calculation.
    refs: [{ kind: 'zone' as const, id: zone.id }, { kind: 'object' as const, id: object.id }],
    changes: [{ ref: { kind: 'object' as const, id: object.id }, kind: 'moved' as const }],
  };
  render(
    <AssistantPanel
      document={parsed.value}
      revision={0}
      response={{ revision: 0, recommendations: [recommendation], explanations: [], mode: 'fallback', fallbackReason: 'проверка' }}
      state={{ status: 'done' }}
      onPreview={vi.fn()}
      onFocus={vi.fn()}
      onAsk={vi.fn()}
    />,
  );
  const panel = screen.getByLabelText('Ассистент');

  const zoneSpan = panel.querySelector('.advice__zone')!;
  expect(zoneSpan.textContent).not.toContain(zone.id);
  expect(zoneSpan.textContent).toContain(zone.name);

  const changeButton = panel.querySelector('.advice__changes button')!;
  expect(changeButton.textContent).toBe(object.label);
  expect(changeButton.getAttribute('data-ref-id')).toBe(object.id);
  expect(changeButton.getAttribute('title')).toBe('Показать на плане');

  const refButtons = [...panel.querySelectorAll('.advice__refs button')];
  expect(refButtons.map((node) => node.textContent)).toEqual([zone.name, object.label]);
  for (const button of refButtons) expect(button.textContent).not.toMatch(/\b(z|eq)_[a-z0-9_]+\b/);
  expect(refButtons[0]!.getAttribute('data-ref-id')).toBe(zone.id);
  expect(refButtons[0]!.getAttribute('title')).toBe('Показать на плане');
  expect(refButtons[1]!.getAttribute('data-ref-id')).toBe(object.id);
  expect(refButtons[1]!.getAttribute('title')).toBe('Показать на плане');
  // #252: без «Отладки» раскрытия «ID зон и объектов» нет.
  const idSummary = (root: Element): HTMLDetailsElement | undefined => [...root.querySelectorAll('details')].find((node) =>
    node.querySelector('summary')?.textContent?.startsWith('ID зон и объектов'),
  );
  expect(idSummary(panel)).toBeUndefined();

  // «Отладка» (#252): id в раскрытии «ID зон и объектов» и в title (review !318).
  cleanup();
  setDebugMode(true);
  render(
    <AssistantPanel
      document={parsed.value}
      revision={0}
      response={{ revision: 0, recommendations: [recommendation], explanations: [], mode: 'fallback', fallbackReason: 'проверка' }}
      state={{ status: 'done' }}
      onPreview={vi.fn()}
      onFocus={vi.fn()}
      onAsk={vi.fn()}
    />,
  );
  const debugPanel = screen.getByLabelText('Ассистент');
  expect(debugPanel.querySelector('.advice__changes button')!.getAttribute('title')).toBe(`Показать на плане · id ${object.id}`);
  const idDetails = [...debugPanel.querySelectorAll('details')].find((node) =>
    node.querySelector('summary')?.textContent?.startsWith('ID зон и объектов'),
  )!;
  expect(idDetails).toBeDefined();
  expect(idDetails.textContent).toContain(zone.id);
  expect(idDetails.textContent).toContain(zone.name);
  expect(idDetails.textContent).toContain(object.id);
  expect(idDetails.textContent).toContain(object.label);
});

test('#10: ограничение со ссылкой на зону теряет id в тексте карточки (D-321)', () => {
  const zone = parsed.value.zones[0]!;
  const calculated = calculateAdvice(parsed.value, { scenario: 'place', typeId: 'ot_workplace', zoneId: null });
  if (!calculated.ok) throw new Error('расчёт не выполнился');
  const recommendation = {
    ...calculated.value[0]!,
    limitations: [...calculated.value[0]!.limitations, `Мест не нашлось в уместных зонах: «${zone.name}» (${zone.id}).`],
  };
  render(
    <AssistantPanel
      document={parsed.value}
      revision={0}
      response={{ revision: 0, recommendations: [recommendation], explanations: [], mode: 'fallback', fallbackReason: 'проверка' }}
      state={{ status: 'done' }}
      onPreview={vi.fn()}
      onFocus={vi.fn()}
      onAsk={vi.fn()}
    />,
  );
  const limitations = screen.getByLabelText('Ассистент').querySelector('.advice__limitations')!;
  expect(limitations.textContent).toContain(zone.name);
  expect(limitations.textContent).not.toContain(zone.id);
});
