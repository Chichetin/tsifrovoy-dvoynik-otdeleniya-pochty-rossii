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
import { setDebugMode } from './debug-mode';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan = parsed.value;
const zone = plan.zones[0]!;
const typeLabel = plan.catalog.objectTypes[0]!.label;

afterEach(() => {
  cleanup();
  setDebugMode(false);
});

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

  test('пока агент работает: живые шаги, aria-busy, вместо отправки — «Остановить» (#137)', () => {
    const { container } = renderChat([
      { id: 'a', question: 'Где окно?', revision: 0, steps: [{ tool: 'plan_overview', label: 'Сводка плана', ok: true }], answer: null, error: null },
    ]);
    expect(container.querySelector('.agent')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Сводка плана')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('работает');
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Остановить' }) as HTMLButtonElement).disabled).toBe(false);
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

  test('#252: размышления свёрнуты, раскрываются по нажатию; служебное имя шага — только в «Отладке»', () => {
    const { container } = renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: answer(), error: null }]);
    const log = container.querySelector<HTMLDetailsElement>('details.agent__log')!;
    expect(log.open).toBe(false);
    expect(log.textContent).not.toContain('find_place');
    fireEvent.click(log.querySelector('summary')!);
    expect(log.open).toBe(true);
    cleanup();
    setDebugMode(true);
    const debug = renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: answer(), error: null }]);
    expect(debug.container.querySelector('details.agent__log')!.textContent).toContain('find_place');
  });

  test('#252: без «Отладки» раскрытия «ID зон и объектов» нет, в title нет id', () => {
    const shown = answer({ refs: [{ kind: 'zone', id: zone.id }] });
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    expect(screen.queryByText(/^ID зон и объектов/)).toBeNull();
    expect(screen.getByRole('button', { name: zone.name }).getAttribute('title')).toBe('Показать на плане');
  });

  test('#252: причина отказа правки без «Отладки» — без id, даже если объекта нет в плане', () => {
    const shown = answer({
      proposals: [{ id: 'p1', commands: [], changes: [], rejected: [{ edit: { op: 'delete', id: 'eq_missing' }, reason: 'Объекта «eq_missing» нет в плане.' }], facts: [], findings: { errors: { before: 0, after: 0 }, warnings: { before: 0, after: 0 } } }],
    });
    const { container } = renderChat([{ id: 'a', question: 'Удали', revision: 0, steps: [], answer: shown, error: null }]);
    const rejected = container.querySelector('.agent__edits .is-failed')!;
    expect(rejected.textContent).toContain('Объекта «без названия» нет в плане.');
    expect(rejected.textContent).not.toContain('eq_missing');
    expect(container.querySelector('.agent__edits ul')!.getAttribute('aria-label')).toBe('Правки: было → стало');
  });

  test('#252: агент работает, шагов ещё нет — «Работаю с планом…» без «0 шагов»', () => {
    const { container } = renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: null, error: null }]);
    expect(container.querySelector('.agent__log summary')!.textContent).toBe('Работаю с планом…');
  });

  test('#252: вопрос с id читается по именам, отправляется с id', () => {
    renderChat([{ id: 'a', question: `Что находится в зоне «${zone.name}» (${zone.id})?`, revision: 0, steps: [], answer: answer(), error: null }]);
    const question = document.querySelector('.agent__question')!;
    expect(question.textContent).toContain(`«${zone.name}»`);
    expect(question.textContent).not.toContain(zone.id);
  });

  test('«Отладка»: id виден в раскрытии «ID зон и объектов» и в title (review !318, #252)', () => {
    setDebugMode(true);
    const shown = answer({ refs: [{ kind: 'zone', id: zone.id }] });
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    expect(screen.getByRole('button', { name: zone.name }).getAttribute('title')).toBe(`Показать на плане · id ${zone.id}`);
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

  test('id, за которым в тексте не стоит зона или объект (например тип или правило), без кнопки; тип и правило — по имени, в «Отладке» — как есть (D-320, #252)', () => {
    const shown = answer({ text: 'Правило rule_workplace_min и тип «Рабочее место» (ot_workplace) в тексте.' });
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    const text = (): Element => screen.getByRole('group', { name: 'Действия по ответу' }).parentElement!.querySelector('.agent__text')!;
    // Neither is a plan entity a click could show: no button. The type reads
    // by its name, the rule by its data.
    expect(text().textContent).toBe(`Правило «${typeLabel}, зона «Клиентская зона»: не меньше 1» и тип «Рабочее место» в тексте.`);
    expect(text().querySelector('button')).toBeNull();
    cleanup();
    setDebugMode(true);
    renderChat([{ id: 'a', question: 'Где?', revision: 0, steps: [], answer: shown, error: null }]);
    expect(text().textContent).toBe('Правило rule_workplace_min и тип «Рабочее место» (ot_workplace) в тексте.');
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
