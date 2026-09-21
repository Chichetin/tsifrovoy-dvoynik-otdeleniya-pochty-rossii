import { describe, expect, test, vi } from 'vitest';
import minimal from '../contracts/fixtures/minimal.json';
import { parsePlanDocument } from '../contracts/schema';
import { calculateAdvice } from '../domain/advice';
import { createPlanStore } from '../state/plan-store';
import { executeAssistantAction } from './App';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('Контрактный fixture minimal.json не разобрался');

describe('executeAssistantAction', () => {
  test('preview changes only display state and never dispatches a plan command', () => {
    const store = createPlanStore(parsed.value);
    const before = store.getState().document;
    const calculated = calculateAdvice(parsed.value, {
      scenario: 'place',
      typeId: 'ot_workplace',
      zoneId: 'z_client',
    });
    if (!calculated.ok) throw new Error('fixture must produce placement advice');
    const recommendation = calculated.value[0];
    const candidate = recommendation?.candidates[0];
    if (recommendation === undefined || candidate === undefined) throw new Error('fixture must have a candidate');
    const setPreview = vi.fn();

    executeAssistantAction(
      { kind: 'preview-candidate', recommendationId: recommendation.id, candidateId: candidate.id },
      {
        document: store.getState().document,
        revision: 0,
        responseRevision: 0,
        recommendations: calculated.value,
        focusOn: vi.fn(),
        setPreview,
        setInventoryFilter: vi.fn(),
        showLayer: vi.fn(),
        setStatus: vi.fn(),
      },
    );

    expect(setPreview).toHaveBeenCalledWith(candidate);
    expect(store.getState().document).toBe(before);
    expect(store.getState().revision).toBe(0);
  });

  test('does not execute stale actions or actions whose target has been removed', () => {
    const status = vi.fn();
    const focusOn = vi.fn();
    const input = {
      document: parsed.value,
      revision: 1,
      responseRevision: 0,
      recommendations: [],
      focusOn,
      setPreview: vi.fn(),
      setInventoryFilter: vi.fn(),
      showLayer: vi.fn(),
      setStatus: status,
    };

    executeAssistantAction({ kind: 'open-properties', objectId: 'deleted' }, input);
    expect(focusOn).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(expect.stringContaining('изменился'));

    executeAssistantAction({ kind: 'open-properties', objectId: 'deleted' }, { ...input, responseRevision: 1 });
    expect(focusOn).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('нет в текущем плане'));
  });
});
