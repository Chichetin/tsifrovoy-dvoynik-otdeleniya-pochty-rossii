// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { calculateAdvice, defaultExplanation } from '../../domain/advice';
import { AssistantPanel } from './AssistantPanel';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');

afterEach(cleanup);

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

/** Ответ на свободный вопрос: одна рекомендация расчёта плюс объяснение к ней. */
const placeResponse = (text?: string) => {
  const calculated = calculateAdvice(parsed.value, {
    scenario: 'place',
    typeId: 'ot_workplace',
    zoneId: null,
  });
  if (!calculated.ok) throw new Error('расчёт не выполнился');
  const recommendations = calculated.value;
  const explanations = recommendations
    .map((recommendation) => defaultExplanation(recommendation))
    .filter((explanation) => explanation !== null)
    .map((explanation) => (text === undefined ? explanation : { ...explanation, text }));
  return { revision: 0, recommendations, explanations };
};

/** Вводит вопрос, спрашивает и показывает пришедший ответ. */
const askWith = (response: {
  revision: number;
  recommendations: ReturnType<typeof placeResponse>['recommendations'];
  explanations: ReturnType<typeof placeResponse>['explanations'];
  mode: 'llm' | 'fallback';
  fallbackReason?: string;
}): void => {
  const props = {
    document: parsed.value,
    revision: 0,
    state: { status: 'done' as const },
    onPreview: vi.fn(),
    onFocus: vi.fn(),
    onAsk: vi.fn(),
  };
  const { rerender } = render(<AssistantPanel {...props} response={null} />);
  fireEvent.change(screen.getByLabelText('Пожелание к варианту (необязательно)'), {
    target: { value: 'ближе ко входу' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Спросить' }));
  rerender(<AssistantPanel {...props} response={response} />);
};

test('проверенный ответ модели показан её словами и отделён от расчёта', () => {
  askWith({ ...placeResponse('Свободное место есть у стены — поставьте окно там.'), mode: 'llm' });

  expect(screen.getByTestId('assistant-answer').textContent).toContain(
    'Свободное место есть у стены',
  );
  expect(screen.getByTestId('assistant-answer').textContent).toContain('Ответ модели');
  // Предложение расчёта подписано рядом со словами модели, чтобы не смешивались.
  expect(screen.getAllByTestId('assistant-calculation')[0]?.textContent).toContain('Расчёт:');
  // Вопрос учтён — плашка про неучтённый вопрос не показывается.
  expect(screen.queryByTestId('assistant-query-ignored')).toBeNull();
});

test('модель есть, а текста нет: плашка не выдумывает причину', () => {
  askWith({ ...placeResponse(), mode: 'llm' });

  expect(screen.queryByTestId('assistant-answer')).toBeNull();
  const notice = screen.getByTestId('assistant-query-ignored').textContent ?? '';
  expect(notice).toContain('ближе ко входу');
  expect(notice).toContain('не дала ответа своими словами');
  // Браузер не различает «модель промолчала» и «текст отклонён» — причину знает
  // журнал сервера, и панель не имеет права называть её наугад.
  expect(notice).not.toContain('не прошёл проверку');
  expect(notice).not.toContain('без модели');
  // Расчёт остался на месте и без слов модели подписи «Расчёт:» не получает.
  expect(screen.getAllByTestId('assistant-calculation')[0]?.textContent).toContain('Место найдено');
  expect(screen.getAllByTestId('assistant-calculation')[0]?.textContent).not.toContain('Расчёт:');
});

test('модели нет: плашка говорит про отсутствие модели, а не про отклонённый текст', () => {
  askWith({ ...placeResponse(), mode: 'fallback', fallbackReason: 'провайдер не настроен' });

  expect(screen.queryByTestId('assistant-answer')).toBeNull();
  const notice = screen.getByTestId('assistant-query-ignored').textContent ?? '';
  expect(notice).toContain('без модели не учитывается');
  expect(notice).not.toContain('не прошёл проверку');
});
