import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Candidate } from '../contracts/advice';
import type { PlanDocument } from '../contracts/model';
import { candidateObjectForInsert, findPlacements } from '../domain/advice';
import { idOwners } from '../domain/commands';
import { decodePlan, encodePlan } from '../persistence/codec';
import { createPlanStore } from '../state/plan-store';

const initial = JSON.parse(readFileSync('demo/before.json', 'utf8')) as PlanDocument;

function suggestion(plan: PlanDocument): Candidate {
  const result = findPlacements(plan, {
    scenario: 'place', typeId: 'ot_queue_terminal', zoneId: 'z_entrance',
  });
  if (!result.ok || result.value[0] === undefined) throw new Error('No placement in fixture');
  return result.value[0];
}

describe('вставка варианта ассистента', () => {
  test('повтор после удаления получает новый ID; undo/redo и файл сохраняют тот же объект', () => {
    const store = createPlanStore(initial);
    const first = suggestion(initial);
    expect(store.getState().dispatch({ type: 'object.put', object: first.object }).ok).toBe(true);
    expect(store.getState().dispatch({ type: 'object.delete', id: first.object.id }).ok).toBe(true);
    const current = store.getState();
    const repeated = suggestion(current.document);
    expect(repeated.object.id).toBe(first.object.id);
    // The store's protection remains in force; the insertion resolves the ID before dispatch.
    expect(current.dispatch({ type: 'object.put', object: repeated.object })).toMatchObject({
      ok: false, issues: [{ code: 'ID_REUSED' }],
    });
    const object = candidateObjectForInsert(current.document, repeated, current.retired);
    expect(object.id).not.toBe(first.object.id);
    expect({ ...object, id: repeated.object.id }).toEqual(repeated.object);
    expect(current.dispatch({ type: 'object.put', object }).ok).toBe(true);
    store.getState().undo();
    expect(store.getState().document.objects.some((item) => item.id === object.id)).toBe(false);
    store.getState().redo();
    expect(store.getState().document.objects.find((item) => item.id === object.id)).toEqual(object);
    const encoded = encodePlan(store.getState().document);
    if (!encoded.ok) throw new Error('Encode failed');
    const decoded = decodePlan(encoded.value);
    expect(decoded).toMatchObject({ ok: true, value: store.getState().document });
    expect(repeated.object.id).toBe(first.object.id);
  });

  test('занятый ID любого вида и retired не становятся ID нового объекта', () => {
    const candidate = suggestion(initial);
    for (const occupied of idOwners(initial).keys()) {
      const input = { ...candidate, object: { ...candidate.object, id: occupied } };
      const object = candidateObjectForInsert(initial, input, new Set(['eq_1', 'eq_2']));
      expect(idOwners(initial).has(object.id)).toBe(false);
      expect(['eq_1', 'eq_2']).not.toContain(object.id);
      expect(input.object.id).toBe(occupied);
    }
  });

  test('свободный ID варианта сохраняется; чужой объект не перезаписывается', () => {
    const candidate = suggestion(initial);
    const object = candidateObjectForInsert(initial, candidate, new Set());
    expect(object).toEqual(candidate.object);
    const store = createPlanStore(initial);
    expect(store.getState().dispatch({ type: 'object.put', object }).ok).toBe(true);
    expect(store.getState().document.objects).toHaveLength(initial.objects.length + 1);
    for (const original of initial.objects) {
      expect(store.getState().document.objects.find((item) => item.id === original.id)).toEqual(original);
    }
  });
});
