// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { readPlanFile } from '../../persistence/format';
import { FileControls, type FileControlsProps } from './FileControls';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('fixture');
const filled = parsed.value;
const empty: PlanDocument = { ...filled, zones: [], objects: [] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function controls(overrides: Partial<FileControlsProps> = {}) {
  const props: FileControlsProps = { document: empty, dirty: true, revision: 0, read: readPlanFile,
    encode: (plan) => ({ ok: true, value: JSON.stringify(plan) }), onReplace: vi.fn(), onNew: vi.fn(), onExported: vi.fn(), storage: null, ...overrides };
  const view = render(<FileControls {...props} />);
  return { props, rerender: (next: Partial<FileControlsProps>) => view.rerender(<FileControls {...props} {...next} />) };
}
function choose(label = 'Исходный демо-план') {
  fireEvent.click(screen.getByRole('button', { name: 'Файл' }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

test('отказ от замены dirty-плана не запускает загрузку', () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { props } = controls({ document: filled, revision: 4 });
  choose();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Несохранённые правки'));
  expect(request).not.toHaveBeenCalled(); expect(props.onReplace).not.toHaveBeenCalled();
});

test('поздний ответ первого выбора не затирает второй, даже если fetch игнорирует abort', async () => {
  const first = deferred();
  const secondPlan = { ...empty, name: 'Более новый выбор' };
  const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Response(JSON.stringify(secondPlan)));
  vi.stubGlobal('fetch', request);
  const { props } = controls();
  choose();
  expect(screen.getByTestId('files-loading').textContent).toContain('загружаем демо');
  choose('Изменённый демо-план');
  await act(async () => undefined);
  expect(props.onReplace).toHaveBeenCalledWith(secondPlan, 'file');
  expect(request.mock.calls[0]![1].signal.aborted).toBe(true);
  await act(async () => { first.resolve(new Response(JSON.stringify(filled))); });
  expect(props.onReplace).toHaveBeenCalledTimes(1);
});

test('правка документа во время загрузки сохраняется и отменяет применение демо', async () => {
  const pending = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
  const { props, rerender } = controls();
  choose();
  rerender({ document: { ...empty, name: 'Мои правки' }, revision: 1 });
  await act(async () => { pending.resolve(new Response(JSON.stringify(filled))); });
  expect(props.onReplace).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('ваши правки сохранены');
});

test('запрос из обучения применяется один раз при повторном рендере', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(filled))); vi.stubGlobal('fetch', request);
  const { props, rerender } = controls();
  await act(async () => { rerender({ demoRequest: { id: 1, variant: 'after' } }); });
  rerender({ demoRequest: { id: 1, variant: 'after' } });
  expect(request).toHaveBeenCalledTimes(1); expect(props.onReplace).toHaveBeenCalledTimes(1);
});

test('повреждённый JSON оставляет документ и показывает обычную ошибку codec', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken')));
  const { props } = controls();
  choose();
  await act(async () => undefined);
  expect(props.onReplace).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('не соответствует');
});
