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

const pngRenderer = vi.hoisted(() => vi.fn<(plan: PlanDocument) => Promise<Blob>>());
vi.mock('../../persistence/plan-png', async (original) => ({
  ...(await original<typeof import('../../persistence/plan-png')>()),
  renderPlanPng: pngRenderer,
}));

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
  return { ok: true, value: { plan: result.value, format: 'ours', assumptions: [], dropped: [], warnings: [] } };
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


const unreadable = {
  ok: false as const,
  issues: [{ code: 'DOCUMENT_UNREADABLE', severity: 'error' as const, message: 'JSON оборван.', refs: [] }],
};

async function openBroken(): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId('plan-file-input'), {
      target: { files: [new File(['{}'], 'broken.json', { type: 'application/json' })] },
    });
  });
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

/** Create, open and demos live in the «Файл» menu (#105): open it, then take the item. */
function menuItem(name: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
  return screen.getByRole('menuitem', { name });
}

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

  test('закончившееся после «Создать новый» чтение не заменяет новый план', async () => {
    const { onReplace } = renderControls({ storage: null });
    const pending = delayedFile();
    fireEvent.click(menuItem('Создать новый'));
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

  test('«Создать новый» на нетронутом пустом плане не спрашивает о несуществующих правках', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNew } = renderControls({ storage: null, document: empty, dirty: true, revision: 0 });

    fireEvent.click(menuItem('Создать новый'));

    expect(confirm).not.toHaveBeenCalled();
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  test('правка даже пустого контура защищена вопросом про новый план', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNew } = renderControls({ storage: null, document: empty, dirty: true, revision: 1 });

    fireEvent.click(menuItem('Создать новый'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Создать новый план?'));
    expect(onNew).not.toHaveBeenCalled();
  });

  // #141: a saved plan loses nothing — it is replaced without the question.
  test('сохранённый непустой план заменяется файлом без вопроса', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderControls({ storage: null, document: filled, dirty: false, revision: 1 });

    fireEvent.click(menuItem('Открыть существующий'));

    expect(confirm).not.toHaveBeenCalled();
  });

  test('код ошибки файла не попадает в основное сообщение, но остаётся в раскрытии', async () => {
    const invalid = {
      ok: false as const,
      issues: [{ code: 'DOCUMENT_UNREADABLE', severity: 'error' as const, message: 'JSON оборван.', refs: [] }],
    };
    renderControls({ storage: null, read: () => invalid });

    await act(async () => {
      fireEvent.change(screen.getByTestId('plan-file-input'), {
        target: { files: [new File(['{}'], 'broken.json', { type: 'application/json' })] },
      });
    });

    expect(screen.getByRole('alert').textContent).toContain('План не открыт');
    expect(screen.getByRole('alert').textContent).not.toContain('DOCUMENT_UNREADABLE');
    expect(screen.getByTestId('file-error-details').textContent).toContain('DOCUMENT_UNREADABLE: JSON оборван.');
  });

  test('ошибку файла снимает крестик «Скрыть сообщение» вместе с раскрытием (D-274)', async () => {
    renderControls({ storage: null, read: () => unreadable });
    await openBroken();

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть сообщение' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('file-error-details')).toBeNull();
  });

  test('ошибка файла пропадает сама, когда план правят дальше (D-274)', async () => {
    const { rerender } = renderControls({ storage: null, read: () => unreadable, revision: 3 });
    await openBroken();
    rerender({ revision: 3 });
    expect(screen.getByRole('alert').textContent).toContain('План не открыт');

    rerender({ revision: 4 });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('file-error-details')).toBeNull();
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
    // D-288: надписи «черновик в браузере: …» в шапке больше нет; о работе
    // черновика говорит само хранилище, а не строка над планом.
    expect(screen.queryByTestId('draft-saved')).toBeNull();
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
    const written = JSON.parse(storage.entries.get(DRAFT_KEY) ?? '{}') as { text: string };
    const layers = (JSON.parse(written.text) as PlanDocument).layers;
    expect(layers.map((layer) => layer.visible)).toEqual(filled.layers.map((layer) => !layer.visible));
  });

  test('черновик, отличающийся от стартового плана только видимостью слоя, не предлагается', () => {
    const toggled: PlanDocument = { ...empty, layers: empty.layers.map((layer) => ({ ...layer, visible: !layer.visible })) };
    renderControls({ storage: fakeStorage(draftOf(toggled)) });
    expect(screen.queryByTestId('draft-restore')).toBeNull();
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

  test('«Создать новый» снимает предложение и возвращает запись черновика', () => {
    const storage = fakeStorage(draftOf(filled));
    const { onNew, rerender } = renderControls({ storage, dirty: false });

    fireEvent.click(menuItem('Создать новый'));

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

  test('«Открыть существующий» снимает предложение и возвращает запись черновика', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));

    expect(screen.queryByTestId('draft-restore')).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.entries.has(DRAFT_KEY)).toBe(true);
  });

  test('«Удалить» до первой правки убирает черновик из хранилища', () => {
    const storage = fakeStorage(draftOf(filled));
    renderControls({ storage });

    fireEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));

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

  test('переключённая видимость слоя — не работа человека: черновик восстанавливается без вопроса', () => {
    const storage = fakeStorage(draftOf(filled));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onReplace, rerender } = renderControls({ storage, document: empty, dirty: true });
    rerender({ document: { ...empty, layers: empty.layers.map((layer) => ({ ...layer, visible: !layer.visible })) } });

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onReplace).toHaveBeenCalledTimes(1);
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

describe('FileControls: меню «Экспорт»', () => {
  function stubDownload() {
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    const downloads: string[] = [];
    return { url, revoke, click, downloads };
  }

  function openMenu(): HTMLElement {
    const trigger = screen.getByRole('button', { name: 'Файл' });
    fireEvent.click(trigger);
    return screen.getByRole('menu', { name: 'Файл' });
  }

  test('кнопка объявляет меню, открывает его и ставит фокус на первый пункт', () => {
    renderControls({ storage: null });
    const trigger = screen.getByRole('button', { name: 'Файл' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    // Прежних отдельных кнопок больше нет.
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Картинка' })).toBeNull();

    openMenu();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    // The menu starts with «Создать новый»; the export items come last (#105).
    expect(items[0]?.textContent).toBe('Создать новый');
    const labels = items.map((item) => item.textContent ?? '');
    for (const word of ['JSON', 'PNG', 'SVG']) expect(labels.some((label) => label.includes(word))).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  test('стрелки ходят по пунктам по кругу, Home и End — к краям', () => {
    renderControls({ storage: null });
    const menu = openMenu();
    const items = screen.getAllByRole('menuitem');

    const last = items[items.length - 1];
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  test('Escape закрывает меню и возвращает фокус на кнопку', () => {
    renderControls({ storage: null });
    const menu = openMenu();

    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Файл' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  test('щелчок мимо меню закрывает его, повторный щелчок по кнопке — тоже', () => {
    renderControls({ storage: null });
    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('«JSON» скачивает файл плана и отмечает план сохранённым', () => {
    const { downloads, revoke } = stubDownload();
    const { onExported } = renderControls({ storage: null, document: filled });
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.endsWith('.json')).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:file');
    expect(onExported).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('files-notice').textContent).toContain('.json');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('«JSON» с планом, который не кодируется, — ошибка, а не успех', () => {
    const { downloads } = stubDownload();
    const { onExported } = renderControls({
      storage: null,
      encode: () => ({
        ok: false,
        issues: [{ code: 'SCHEMA_INVALID', severity: 'error', message: 'Нет помещения.', refs: [] }],
      }),
    });
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));

    expect(downloads).toEqual([]);
    expect(onExported).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('План не сохранён');
    // Код и текст находки — в раскрытии «Технические сведения» (D-253), не в строке для человека.
    expect(alert.textContent).not.toContain('SCHEMA_INVALID');
    expect(screen.getByTestId('file-error-details').textContent).toContain('SCHEMA_INVALID: Нет помещения.');
  });

  test('«PNG» скачивает картинку и не выдаёт её за сохранение', async () => {
    const { downloads } = stubDownload();
    pngRenderer.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const { onExported } = renderControls({ storage: null, document: filled });
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /PNG/ }));
    expect(screen.getByTestId('files-loading').textContent).toContain('картинк');
    await act(async () => {});

    expect(pngRenderer).toHaveBeenCalledWith(filled);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.endsWith('.png')).toBe(true);
    expect(screen.getByTestId('files-notice').textContent).toContain('.png');
    expect(onExported).not.toHaveBeenCalled();
  });

  test('отказ растеризации виден человеку и ничего не скачивает', async () => {
    const { downloads } = stubDownload();
    pngRenderer.mockRejectedValue(new Error('Растровый холст недоступен в этом браузере.'));
    const { onExported } = renderControls({ storage: null, document: filled });
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /PNG/ }));
    await act(async () => {});

    expect(downloads).toEqual([]);
    expect(onExported).not.toHaveBeenCalled();
    expect(screen.queryByTestId('files-notice')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Картинка PNG не выгружена');
    expect(screen.getByRole('alert').textContent).toContain('Растровый холст недоступен');
  });

  test('«SVG» на свежей странице показывает результат, а не молчит', () => {
    // Ревью MR !73: до починки уведомление ставилось, но состояние оставалось
    // idle, и строка результата не рендерилась — файл уходил в загрузки молча.
    const { downloads, revoke } = stubDownload();
    const { onExported } = renderControls({ storage: null });
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /SVG/ }));

    expect(downloads).toHaveLength(1);
    expect(revoke).toHaveBeenCalledWith('blob:file');
    expect(screen.getByTestId('files-notice').textContent).toContain('.svg');
    // Картинка — не сохранение.
    expect(onExported).not.toHaveBeenCalled();
  });
  test('стрелка вниз на кнопке открывает меню на первом пункте, вверх — на последнем', () => {
    renderControls({ storage: null });
    const trigger = screen.getByRole('button', { name: 'Файл' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  test('после PNG чтение файла подписано как чтение файла, а не как картинка', async () => {
    stubDownload();
    pngRenderer.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderControls({ storage: null, document: filled, dirty: false });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /PNG/ }));
    await act(async () => {});

    const file = new File([], 'slow.json');
    vi.spyOn(file, 'text').mockReturnValue(new Promise<string>(() => undefined));
    fireEvent.change(screen.getByTestId('plan-file-input'), { target: { files: [file] } });

    expect(screen.getByTestId('files-loading').textContent).toBe('читаем файл…');
  });

  test('поздний ответ растеризации не перетирает начатое открытие файла', async () => {
    stubDownload();
    let finishPng!: (blob: Blob) => void;
    pngRenderer.mockReturnValue(new Promise<Blob>((done) => { finishPng = done; }));
    renderControls({ storage: null, document: filled, dirty: false });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /PNG/ }));

    const file = new File([], 'slow.json');
    vi.spyOn(file, 'text').mockReturnValue(new Promise<string>(() => undefined));
    fireEvent.change(screen.getByTestId('plan-file-input'), { target: { files: [file] } });
    await act(async () => { finishPng(new Blob(['png'], { type: 'image/png' })); });

    expect(screen.getByTestId('files-loading').textContent).toBe('читаем файл…');
    expect(screen.queryByTestId('files-notice')).toBeNull();
  });
  test('поздний ответ PNG не перетирает результат более позднего «Экспорт → JSON»', async () => {
    const { downloads } = stubDownload();
    let finishPng!: (blob: Blob) => void;
    pngRenderer.mockReturnValue(new Promise<Blob>((done) => { finishPng = done; }));
    renderControls({ storage: null, document: filled });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /PNG/ }));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));
    expect(screen.getByTestId('files-notice').textContent).toContain('.json');

    await act(async () => { finishPng(new Blob(['png'], { type: 'image/png' })); });

    expect(screen.getByTestId('files-notice').textContent).toContain('.json');
    expect(downloads.filter((name) => name.endsWith('.png'))).toEqual([]);
  });
});

/**
 * D-286: план с нарушением физики файлом с первого нажатия не уходит. Отказ
 * не окончательный: нарушения приходят и чужим файлом, и проверяющий должен
 * уметь сохранить такой план обратно.
 */
describe('FileControls: отказ сохранить план с нарушением физики', () => {
  /** Стул ровно на столе: объёмы пересекаются и по месту, и по высоте. */
  const collided: PlanDocument = {
    ...filled,
    objects: [
      ...filled.objects,
      { ...filled.objects[0]!, id: 'eq_chair', label: 'Стул', height_m: 0.9 },
    ],
  };

  function stubDownload() {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    return downloads;
  }

  function exportJson(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));
  }

  test('окно называет нарушение, файл не скачивается, план остаётся несохранённым', () => {
    const downloads = stubDownload();
    const { onExported } = renderControls({ storage: null, document: collided });

    exportJson();

    const dialog = screen.getByTestId('save-blocked');
    expect(dialog.textContent).toMatch(/1\s+нарушение физики/);
    expect(downloads).toEqual([]);
    expect(onExported).not.toHaveBeenCalled();
  });

  test('«Сохранить всё равно» отдаёт файл браузеру', () => {
    const downloads = stubDownload();
    const { onExported } = renderControls({ storage: null, document: collided });
    exportJson();

    fireEvent.click(screen.getByTestId('save-anyway'));

    expect(screen.queryByTestId('save-blocked')).toBeNull();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.endsWith('.json')).toBe(true);
    expect(onExported).toHaveBeenCalledTimes(1);
  });

  test('«Показать в «Проверке»» закрывает окно, открывает проверку и ничего не сохраняет', () => {
    const downloads = stubDownload();
    const onShowValidation = vi.fn();
    const { onExported } = renderControls({ storage: null, document: collided, onShowValidation });
    exportJson();

    fireEvent.click(screen.getByRole('button', { name: 'Показать в «Проверке»' }));
    expect(onShowValidation).toHaveBeenCalledTimes(1);

    expect(screen.queryByTestId('save-blocked')).toBeNull();
    expect(downloads).toEqual([]);
    expect(onExported).not.toHaveBeenCalled();
  });

  test('чистый план сохраняется без вопросов, картинки гейт не трогает', async () => {
    const downloads = stubDownload();
    renderControls({ storage: null, document: filled });
    exportJson();
    expect(screen.queryByTestId('save-blocked')).toBeNull();
    expect(downloads).toHaveLength(1);

    cleanup();
    pngRenderer.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderControls({ storage: null, document: collided });
    fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /PNG/ }));
    });
    expect(screen.queryByTestId('save-blocked')).toBeNull();
    expect(downloads.filter((name) => name.endsWith('.png'))).toHaveLength(1);
  });
});

/**
 * D-291: полоса сообщений о файле не висит над планом постоянно. Успех уходит
 * сам через семь секунд, ошибка — никогда по времени: её гасит крестик или
 * следующая правка плана (D-274).
 */
describe('FileControls: сообщение о файле живёт семь секунд', () => {
  function waitLifetime(): void {
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
  }

  test('«План … открыт» исчезает, полосы больше нет', async () => {
    renderControls({ storage: null });
    await act(async () => {
      fireEvent.change(screen.getByTestId('plan-file-input'), {
        target: { files: [new File([JSON.stringify(filled)], 'plan.json', { type: 'application/json' })] },
      });
    });
    expect(screen.getByTestId('files-notice').textContent).toContain('открыт');

    waitLifetime();

    expect(screen.queryByTestId('files-notice')).toBeNull();
    expect(document.querySelector('.files__messages')).toBeNull();
  });

  test('новое сообщение заводит отсчёт заново', async () => {
    const { rerender } = renderControls({ storage: null });
    await act(async () => {
      fireEvent.change(screen.getByTestId('plan-file-input'), {
        target: { files: [new File([JSON.stringify(filled)], 'plan.json', { type: 'application/json' })] },
      });
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId('files-notice')).toBeTruthy();

    // Вторая выгрузка через пять секунд: полоса живёт свои семь, а не две.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    rerender({ document: filled });
    fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));
    expect(screen.getByTestId('files-notice').textContent).toContain('.json');

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId('files-notice').textContent).toContain('.json');

    waitLifetime();
    expect(screen.queryByTestId('files-notice')).toBeNull();
  });

  test('ошибка файла по времени не уходит', async () => {
    renderControls({ storage: null, read: () => unreadable });
    await openBroken();
    expect(screen.getByRole('alert').textContent).toContain('План не открыт');

    waitLifetime();
    waitLifetime();

    expect(screen.getByRole('alert').textContent).toContain('План не открыт');
  });
});
