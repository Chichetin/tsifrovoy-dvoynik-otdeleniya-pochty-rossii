// @vitest-environment jsdom
/**
 * D-258: the chat panel — asking, the live work log, the verified answer with
 * clickable ids, the actions and their stale state.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AgentAnswer, AgentExchange } from '../../contracts/advice-chat';
import minimal from '../../contracts/fixtures/minimal.json';
import { parsePlanDocument } from '../../contracts/schema';
import { answerWithoutModel } from '../../domain/advice';
import { planIndex } from '../../domain/plan-index';
import { AgentChat } from './AgentChat';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan = parsed.value;
const zone = plan.zones[0]!;
const typeLabel = plan.catalog.objectTypes[0]!.label;

afterEach(cleanup);

function answer(overrides: Partial<AgentAnswer> = {}): AgentAnswer {
  return {
    revision: 0,
    mode: 'llm',
    text: `Место есть в зоне ${zone.id}.`,
    steps: [{ tool: 'find_place', label: 'Поиск места', ok: true }],
    recommendations: [],
    proposals: [],
    actions: [{ kind: 'focus', ref: { kind: 'zone', id: zone.id } }],
    refs: [],
    ...overrides,
  };
}

function renderChat(exchanges: AgentExchange[], extra: Partial<Parameters<typeof AgentChat>[0]> = {}) {
  const props = {
    plan,
    revision: 0,
    names: planIndex(plan),
    exchanges,
    actionStatus: null,
    onAsk: vi.fn(),
    onAction: vi.fn(),
    onClear: vi.fn(),
    ...extra,
  };
  return { ...render(<AgentChat {...props} />), props };
}

describe('чат агента', () => {
  test('пустой диалог: пример вопроса отправляется одним щелчком, Enter отправляет поле', () => {
    const { props } = renderChat([]);
    fireEvent.click(screen.getByRole('button', { name: /кассовое окно/ }));
    expect(props.onAsk).toHaveBeenCalledWith('Где поставить ещё одно кассовое окно ближе к входу?');
    const field = screen.getByLabelText('Вопрос ассистенту');
    fireEvent.change(field, { target: { value: '  Что с планом?  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onAsk).toHaveBeenLastCalledWith('Что с планом?');
    expect((screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('пока агент работает: живые шаги, aria-busy, отправка заблокирована', () => {
    const { container } = renderChat([
      { id: 'a', question: 'Где окно?', revision: 0, steps: [{ tool: 'plan_overview', label: 'Сводка плана', ok: true }], answer: null, error: null },
    ]);
    expect(container.querySelector('.agent')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Сводка плана')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('работает');
    expect((screen.getByRole('button', { name: 'Работаю…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('ответ: зона в тексте — кнопка с её названием, а не голым id (#10)', () => {
    const shown = answer();
    const { props } = renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    // The button reads by the zone's name; the id is not printed, only kept for the click and in `title`/`data-ref-id`.
    const button = screen.getByRole('button', { name: zone.name });
    expect(button.textContent).not.toContain(zone.id);
    expect(button.getAttribute('data-ref-id')).toBe(zone.id);
    fireEvent.click(button);
    expect(props.onAction).toHaveBeenCalledWith({ kind: 'focus', ref: { kind: 'zone', id: zone.id } }, shown);
    expect(screen.getByText(/LLM выбрала рассчитанные факты/)).toBeDefined();
    const actions = screen.getByRole('group', { name: 'Действия по ответу' });
    expect(within(actions).getByRole('button', { name: `Показать: ${zone.name}` })).toBeDefined();
    expect(screen.getByText(/Ход проверки: 1 шаг/)).toBeDefined();
  });

  test('ответ: id виден без DevTools в раскрытии «ID зон и объектов» (review !318)', () => {
    const shown = answer({ refs: [{ kind: 'zone', id: zone.id }] });
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    const details = [...screen.getAllByText(/^ID зон и объектов/)].map((node) => node.closest('details'))[0]!;
    expect(details.textContent).toContain(zone.id);
    expect(details.textContent).toContain(zone.name);
  });

  test('«name» (id) канонической формы сворачивается в одну кнопку с именем, без дубля и без id (D-320)', () => {
    const shown = answer({ text: `Зона «${zone.name}» (${zone.id}) свободна.` });
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    const text = screen.getByRole('group', { name: 'Действия по ответу' }).parentElement!.querySelector('.agent__text')!;
    expect(text.textContent).toBe(`Зона ${zone.name} свободна.`);
    expect(screen.getByRole('button', { name: zone.name })).toBeDefined();
  });

  test('id, за которым в тексте не стоит зона или объект (например тип или правило), остаётся как есть и без кнопки (D-320, review !318)', () => {
    const shown = answer({ text: 'Правило rule_bench_min и тип «Рабочее место» (ot_workplace) в тексте.' });
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    const text = screen.getByRole('group', { name: 'Действия по ответу' }).parentElement!.querySelector('.agent__text')!;
    // Neither is a plan entity a click could show: the sentence is left
    // exactly as the calculation wrote it, id included — no click to offer,
    // so trimming the id would only take away information (review of !318).
    expect(text.textContent).toBe('Правило rule_bench_min и тип «Рабочее место» (ot_workplace) в тексте.');
    expect(text.querySelector('button')).toBeNull();
  });

  test('ответ без модели: вариант с кнопкой «Применить» — основной, причина названа', () => {
    const typeId = plan.catalog.objectTypes[0]!.id;
    const fallback = answerWithoutModel(plan, null, `Куда поставить ${typeLabel}?`, 0, 'Провайдер не настроен.');
    const apply = fallback.actions.find((action) => action.kind === 'apply-candidate');
    expect(apply, `в minimal.json должен найтись вариант для ${typeId}`).toBeDefined();
    const { props } = renderChat([{ id: 'a', question: 'Куда?', revision: 0, steps: [], answer: fallback, error: null }]);
    expect(screen.getByText(/Без LLM: Провайдер не настроен/)).toBeDefined();
    const button = screen.getByRole('button', { name: /^Применить:/ });
    expect(button.className).toContain('is-primary');
    fireEvent.click(button);
    expect(props.onAction).toHaveBeenCalledWith(apply, fallback);
  });

  test('план изменился после ответа — действия отключены, статус говорит почему', () => {
    const { props } = renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: answer(), error: null }], { revision: 2 });
    const button = screen.getByRole('button', { name: `Показать: ${zone.name}` }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(props.onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('План изменился');
  });

  test('ошибка ответа видна как alert, диалог можно начать заново', () => {
    const { props } = renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: null, error: 'Сервер ответил кодом 400.' }]);
    expect(screen.getByRole('alert').textContent).toBe('Сервер ответил кодом 400.');
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    expect(props.onClear).toHaveBeenCalled();
  });
});

test('после «Применить» статус подтверждает действие, а не пугает устареванием', () => {
  renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: answer(), error: null }], { revision: 1, actionStatus: 'Применено: «Окно» поставлен на план. Отменить — Ctrl+Z.' });
  expect(screen.getByRole('status').textContent).toContain('Применено');
});
