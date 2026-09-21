// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { calculateAdvice, defaultExplanation } from '../../domain/advice';
import { AssistantPanel } from './AssistantPanel';
import type { ChatTurn } from '../../contracts/advice-chat';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');

afterEach(cleanup);

test('разговорный вопрос отправляется формой; пустой запрос и повтор при загрузке запрещены', () => {
  const onAskChat = vi.fn();
  const props = { document: parsed.value, revision: 0, response: null, state: { status: 'idle' as const }, onAsk: vi.fn(), onFocus: vi.fn(), onPreview: vi.fn(), onAskChat };
  const { rerender } = render(<AssistantPanel {...props} />);
  const send = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Вопрос ассистенту'), { target: { value: ' Где добавить окно? ' } });
  fireEvent.submit(send.closest('form')!);
  expect(onAskChat).toHaveBeenCalledWith('Где добавить окно?');
  rerender(<AssistantPanel {...props} state={{ status: 'loading' }} />);
  expect(send.disabled).toBe(true);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true');
});

test('история показывает уточнение и проверенные действия; новая ревизия отключает действие', () => {
  const onAssistantAction = vi.fn();
  const turns: ChatTurn[] = [{ id: 't1', revision: 0, intent: { kind: 'clarify', question: 'Какое оборудование нужно?' }, selection: null, refs: [] }, { id: 't2', revision: 0, intent: { kind: 'request', request: { scenario: 'equipment', zoneId: null }, preference: null }, selection: { selections: [{ recommendationId: 'r1', factIds: ['f1'], actions: [{ kind: 'focus', ref: { kind: 'zone', id: 'z_client' } }] }] }, refs: [] }];
  const props = { document: parsed.value, revision: 0, response: null, state: { status: 'done' as const }, onAsk: vi.fn(), onAskChat: vi.fn(), onFocus: vi.fn(), onPreview: vi.fn(), chatTurns: turns, onAssistantAction };
  const { rerender } = render(<AssistantPanel {...props} />);
  expect(screen.getByLabelText('История диалога').textContent).toContain('Какое оборудование нужно?');
  const action = screen.getByRole('button', { name: 'Показать на плане' }) as HTMLButtonElement;
  fireEvent.click(action);
  expect(onAssistantAction).toHaveBeenCalledWith({ kind: 'focus', ref: { kind: 'zone', id: 'z_client' } });
  rerender(<AssistantPanel {...props} revision={1} />);
  expect(action.disabled).toBe(true);
  fireEvent.click(action);
  expect(onAssistantAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('План изменился');
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
