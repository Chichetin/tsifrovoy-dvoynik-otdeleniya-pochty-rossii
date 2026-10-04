// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import before from '../../demo/before.json';
import after from '../../demo/after.json';
import type { PlanDocument } from '../contracts/model';
import type { EditorSession } from '../contracts/ui';
import { createPlanStore } from '../state/plan-store';
import { PropertiesPanel } from '../features/properties/PropertiesPanel';

afterEach(cleanup);
const plan = before as unknown as PlanDocument;
const bench = (after as unknown as PlanDocument).objects.find((object) => object.id === 'eq_54');
if (bench === undefined) throw new Error('No bench in fixture');
const initial = { ...bench, position: [8, 3] as [number, number] };
const session: EditorSession = {
  tool: { kind: 'select' }, viewport: { origin: [0, 0], scale: 40 },
  selection: { kind: 'object', id: bench.id }, preview: null, focus: null,
};

test('оба промежуточных положения заняты, но X/Y применяются вместе одним шагом истории', () => {
  const store = createPlanStore(plan);
  expect(store.getState().dispatch({ type: 'object.put', object: initial }).ok).toBe(true);
  for (const position of [[2.2, 3], [8, 2]] as [number, number][]) {
    expect(store.getState().dispatch({ type: 'object.put', object: { ...initial, position } })).toMatchObject({
      ok: false, issues: [{ code: 'OBJECT_COLLISION' }],
    });
  }
  const rendered = render(<PropertiesPanel document={store.getState().document} session={session} onCommand={store.getState().dispatch} />);
  fireEvent.change(screen.getByLabelText('X, м'), { target: { value: '2.2' } });
  fireEvent.change(screen.getByLabelText('Y, м'), { target: { value: '2' } });
  expect(store.getState().document.objects.find((object) => object.id === bench.id)?.position).toEqual([8, 3]);
  fireEvent.click(screen.getByRole('button', { name: 'Применить координаты' }));
  expect(store.getState().document.objects.find((object) => object.id === bench.id)?.position).toEqual([2.2, 2]);
  act(() => { store.getState().undo(); });
  expect(store.getState().document.objects.find((object) => object.id === bench.id)?.position).toEqual([8, 3]);
  store.getState().redo();
  rendered.rerender(<PropertiesPanel document={store.getState().document} session={session} onCommand={store.getState().dispatch} />);
  expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe('2.2');
});

test('отказ конечной точки сохраняет черновик; Escape и внешний перенос снимают его', () => {
  const store = createPlanStore({ ...plan, objects: [...plan.objects, initial] });
  const props = { document: store.getState().document, session, onCommand: store.getState().dispatch };
  const rendered = render(<PropertiesPanel {...props} />);
  fireEvent.change(screen.getByLabelText('X, м'), { target: { value: '2.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Применить координаты' }));
  expect(screen.getByRole('alert').textContent).toMatch(/занимают одно место/);
  expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe('2.2');
  expect(store.getState().document).toBe(props.document);
  fireEvent.keyDown(screen.getByLabelText('X, м'), { key: 'Escape' });
  expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe('8');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(screen.getByLabelText('X, м'), { target: { value: '2.2' } });
  const moved = { ...props.document, objects: props.document.objects.map((object) => object.id === bench.id ? { ...object, position: [2.2, 2] as [number, number] } : object) };
  rendered.rerender(<PropertiesPanel {...props} document={moved} />);
  expect((screen.getByLabelText('Y, м') as HTMLInputElement).value).toBe('2');
});

test('пустая координата не становится нулём и не меняет документ; сброс доступен', () => {
  const store = createPlanStore({ ...plan, objects: [...plan.objects, initial] });
  const snapshot = store.getState().document;
  render(<PropertiesPanel document={snapshot} session={session} onCommand={store.getState().dispatch} />);
  fireEvent.change(screen.getByLabelText('X, м'), { target: { value: '' } });
  expect(screen.getByRole('alert').textContent).toContain('Нужно число');
  fireEvent.click(screen.getByRole('button', { name: 'Применить координаты' }));
  expect(store.getState().document).toBe(snapshot);
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить координаты' }));
  expect((screen.getByLabelText('X, м') as HTMLInputElement).value).toBe('8');
});
