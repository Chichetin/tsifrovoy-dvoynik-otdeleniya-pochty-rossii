// @vitest-environment jsdom
/**
 * IO03: что группа кнопок обещает пользователю, когда в браузере лежит черновик.
 *
 * Здесь проверяется то, что в браузерном сценарии не увидеть: хранилище
 * подставлено своё (`storage`), время — поддельное, а «правка плана» — это новый
 * `document` в пропсах, ровно как его отдаёт store. Главное свойство: пока
 * предложение восстановить черновик висит, писать нельзя, но любое действие
 * пользователя с документом возвращает запись — иначе работа за сессию теряется.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument, Result } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { DRAFT_KEY, type DraftStorage, type PlanDraft } from '../../persistence/browser-draft';
import type { OpenedPlan } from '../../persistence/format';
import { FileControls } from './FileControls';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
/** План с зоной и объектом: «непустой документ», который есть что потерять. */
const filled: PlanDocument = parsed.value;
/** Пустой: помещение и слои есть, ничего не размещено — терять нечего. */
const empty: PlanDocument = { ...filled, zones: [], objects: [] };

function encode(plan: PlanDocument): Result<string> {
  return { ok: true, value: JSON.stringify(plan) };
}

function read(text: string): Result<OpenedPlan> {
  const result = parsePlanDocument(JSON.parse(text) as unknown);
  if (!result.ok) return result;
  return { ok: true, value: { plan: result.value, format: 'ours', assumptions: [], dropped: [] } };
}

type Fake = DraftStorage & { entries: Map<string, string> };

function fakeStorage(seed?: PlanDraft): Fake {
  const entries = new Map<string, string>();
  if (seed !== undefined) entries.set(DRAFT_KEY, JSON.stringify(seed));
  return {
    entries,
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void entries.set(key, value)),
    removeItem: vi.fn((key: string) => void entries.delete(key)),
  };
}

function draftOf(plan: PlanDocument, name = 'План из черновика'): PlanDraft {
  return { savedAt: '2026-09-17T09:00:00.000Z', name, text: JSON.stringify(plan) };
}

type Overrides = Partial<React.ComponentProps<typeof FileControls>>;

function renderControls(overrides: Overrides = {}) {
  const onReplace = vi.fn();
  const onNew = vi.fn();
  const onExported = vi.fn();
  const view = render(
    <FileControls
      document={empty}
      dirty={true}
      revision={0}
      read={read}
      encode={encode}
      onReplace={onReplace}
      onNew={onNew}
      onExported={onExported}
      {...overrides}
    />,
  );
  const rerender = (props: Overrides): void => {
    view.rerender(
      <FileControls
        document={empty}
        dirty={true}
        revision={0}
        read={read}
        encode={encode}
        onReplace={onReplace}
        onNew={onNew}
        onExported={onExported}
        {...overrides}
        {...props}
      />,
    );
  };
  return { onReplace, onNew, onExported, rerender };
}

/** Дебаунс черновика — 700 мс; полторы секунды заведомо его переживают. */
function waitDebounce(): void {
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('FileControls: замена текущего плана', () => {
  function delayedFile() {
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
    const file = new File([], 'slow.json');
    vi.spyOn(file, 'text').mockReturnValue(result);
    fireEvent.change(screen.getByTestId('plan-file-input'), { target: { files: [file] } });
    return {
      finish: () => act(async () => { resolve(JSON.stringify(filled)); }),
      fail: () => act(async () => { reject(new Error('Старый файл недоступен')); }),
    };
  }

  test('закончившееся после «Новый» чтение не заменяет новый план', async () => {
    const { onReplace } = renderControls({ storage: null });
    const pending = delayedFile();
    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));
    await pending.finish();
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('files-notice')).toBeNull();
  });

  test('правки во время чтения сохраняются, открытие отменяется с объяснением', async () => {
    const { onReplace, rerender } = renderControls({ storage: null });
    const pending = delayedFile();
    rerender({ document: { ...empty, name: 'Свежие правки' }, revision: 1 });
    await pending.finish();
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('изменён');
    expect(screen.queryByTestId('files-loading')).toBeNull();
  });

  test.each(['finish', 'fail'] as const)('более раннее чтение (%s) не перезаписывает результат нового открытия', async (ending) => {
    const { onReplace } = renderControls({ storage: null });
    const pending = delayedFile();
    const latest = { ...filled, name: 'Последний выбранный файл' };
    await act(async () => {
      fireEvent.change(screen.getByTestId('plan-file-input'), {
        target: { files: [new File([JSON.stringify(latest)], 'latest.json')] },
      });
    });
    await pending[ending]();
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('files-notice').textContent).toContain(latest.name);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('восстановление черновика отменяет ожидающее чтение файла', async () => {
    const { onReplace } = renderControls({ storage: fakeStorage(draftOf(filled)) });
    const pending = delayedFile();
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));
    await pending.finish();
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace).toHaveBeenCalledWith(filled, 'draft');
  });

  test('«Новый» на нетронутом пустом плане не спрашивает о несуществующих правках', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNew } = renderControls({ storage: null, document: empty, dirty: true, revision: 0 });
    expect(screen.getByText('новый план не сохранён')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  test('правка даже пустого контура защищена вопросом про новый план', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNew } = renderControls({ storage: null, document: empty, dirty: true, revision: 1 });
    expect(screen.getByText('есть несохранённые правки')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Создать новый план?'));
    expect(onNew).not.toHaveBeenCalled();
  });

  test('сохранённый, но непустой план не заменяется файлом без согласия', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderControls({ storage: null, document: filled, dirty: false, revision: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(confirm).toHaveBeenCalledWith(
      'Текущий план будет заменён. Открыть другой файл?',
    );
  });
});

describe('FileControls: хранилище черновика', () => {
  test('storage={null} не трогает localStorage браузера: ни чтения предложения, ни записи', () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draftOf(filled)));
    const before = window.localStorage.getItem(DRAFT_KEY);
    const { rerender } = renderControls({ storage: null });

    expect(screen.queryByTestId('draft-restore')).toBeNull();
    rerender({ document: filled });
    waitDebounce();

    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(before);
    expect(screen.getByTestId('draft-saved').textContent).toContain('ещё нет');
  });

  test('переданное хранилище и читается, и пишется вместо localStorage', () => {
    const storage = fakeStorage();
    const { rerender } = renderControls({ storage });

    rerender({ document: filled });
    waitDebounce();

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const written = JSON.parse(storage.entries.get(DRAFT_KEY) ?? 'null') as PlanDraft;
    expect(written.name).toBe(filled.name);
    expect(JSON.parse(written.text)).toEqual(filled);
    expect(screen.getByTestId('draft-saved').textContent).not.toContain('ещё нет');
  });
});

describe('FileControls: предложение восстановить черновик', () => {
  test('пока на предложение не ответили и план не тронули, черновик не перезаписывается', () => {
    const storage = fakeStorage(draftOf(filled));
    renderControls({ storage });

    expect(screen.getByTestId('draft-restore').textContent).toContain('План из черновика');
    waitDebounce();

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('показ или скрытие слоя — не правка: черновик не пишется, пока предложение висит (D-207)', () => {
    const storage = fakeStorage(draftOf(filled));
    const { rerender } = renderControls({ storage });
    waitDebounce();

    rerender({ document: { ...empty, layers: empty.layers.map((layer) => ({ ...layer, visible: !layer.visible })) } });
    waitDebounce();
    expect(storage.setItem).not.toHaveBeenCalled();

    // А настоящая правка при том же скрытом слое — пишется, и с этим слоем.
    rerender({ document: { ...filled, layers: filled.layers.map((layer) => ({ ...layer, visible: !layer.visible })) } });
    waitDebounce();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test('первая правка плана возвращает запись черновика, хотя предложение ещё на экране', () => {
    const storage = fakeStorage(draftOf(filled));
    const { rerender } = renderControls({ storage });
    waitDebounce();
    expect(storage.setItem).not.toHaveBeenCalled();

    // Пользователь начал работать с тем, что открыто: его работу надо помнить.
    rerender({ document: filled });
    waitDebounce();

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    // Предложение остаётся: правка — ещё не ответ «мне нужен этот черновик».
    expect(screen.queryByTestId('draft-restore')).not.toBeNull();
  });

  test('«Новый» снимает предложение и возвращает запись черновика', () => {
    const storage = fakeStorage(draftOf(filled));
    const { onNew, rerender } = renderControls({ storage, dirty: false });

    fireEvent.click(screen.getByRole('button', { name: 'Новый' }));

    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('draft-restore')).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(DRAFT_KEY);

    // Запись возобновляется сразу, до всякой правки: ворота снимает сам ответ
    // на предложение, а не то, что план стал отличаться от стартового.
    waitDebounce();
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    rerender({ document: filled });
    waitDebounce();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  test('«Открыть» снимает предложение и возвращает запись черновика', async () => {
    const storage = fakeStorage(draftOf(filled));
    const { onReplace } = renderControls({ storage });
    const file = new File([JSON.stringify(filled)], 'plan.json', { type: 'application/json' });

    await act(async () => {
      fireEvent.change(screen.getByTestId('plan-file-input'), { target: { files: [file] } });
    });

    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('draft-restore')).toBeNull();
    // Документ в пропсах остался стартовым (родитель — заглушка), и всё равно
    // пишется: открытие файла — ответ на предложение.
    waitDebounce();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test('«Удалить» после возобновившейся записи не стирает уже сохранённую работу', () => {
    const storage = fakeStorage(draftOf(filled));
    const { rerender } = renderControls({ storage });
    rerender({ document: filled });
    waitDebounce();
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(screen.queryByTestId('draft-restore')).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.entries.has(DRAFT_KEY)).toBe(true);
  });

  test('«Удалить» до первой правки убирает черновик из хранилища', () => {
    const storage = fakeStorage(draftOf(filled));
    renderControls({ storage });

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(storage.removeItem).toHaveBeenCalledWith(DRAFT_KEY);
    expect(storage.entries.has(DRAFT_KEY)).toBe(false);
  });
});

describe('FileControls: восстановление поверх открытого документа', () => {
  test('непустой документ не заменяется черновиком без подтверждения, даже когда он сохранён', () => {
    const storage = fakeStorage(draftOf(empty, 'Пустой черновик'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    // dirty=false — ровно то состояние, в котором план только что открыли из файла.
    const { onReplace } = renderControls({ storage, document: filled, dirty: false });

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('draft-restore')).not.toBeNull();
  });

  test('согласие открывает черновик как несохранённый план', () => {
    const storage = fakeStorage(draftOf(empty, 'Пустой черновик'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onReplace } = renderControls({ storage, document: filled, dirty: false });

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));

    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace.mock.calls[0]?.[1]).toBe('draft');
    expect(screen.queryByTestId('draft-restore')).toBeNull();
  });

  test('пустой, но уже тронутый план тоже спрашивает: зон и объектов нет, а правки есть', () => {
    const storage = fakeStorage(draftOf(filled));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onReplace, rerender } = renderControls({ storage, document: empty, dirty: true });

    // Ни зон, ни объектов — но помещение переименовали, и это работа человека.
    rerender({ document: { ...empty, name: 'Переименованное ОПС' } });
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onReplace).not.toHaveBeenCalled();
  });

  test('в пустом плане терять нечего: черновик восстанавливается без вопроса', () => {
    const storage = fakeStorage(draftOf(filled));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onReplace } = renderControls({ storage, document: empty, dirty: true });

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect((onReplace.mock.calls[0]?.[0] as PlanDocument).objects).toHaveLength(1);
  });
});

describe('FileControls: картинка плана', () => {
  test('«Картинка» на свежей странице показывает результат, а не молчит', () => {
    // Ревью MR !73: до починки уведомление ставилось, но состояние оставалось
    // idle, и строка результата не рендерилась — файл уходил в загрузки молча.
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { onExported } = renderControls({ storage: null });

    fireEvent.click(screen.getByTestId('export-svg'));

    expect(click).toHaveBeenCalledTimes(1);
    expect(url).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:svg');
    expect(screen.getByTestId('files-notice').textContent).toContain('Картинка');
    expect(screen.getByTestId('files-notice').textContent).toContain('.svg');
    // Картинка — не сохранение.
    expect(onExported).not.toHaveBeenCalled();
  });
});
