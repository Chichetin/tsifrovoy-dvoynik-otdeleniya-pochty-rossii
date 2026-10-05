import { describe, expect, it } from 'vitest';
import type { Issue, PlanDocument } from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';
import minimal from '../contracts/fixtures/minimal.json';
import { documentNotice, isEditErrorCurrent, refusalOf } from './edit-error';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan: PlanDocument = parsed.value;

const issue = (message: string, refs: Issue['refs']): Issue => ({ code: 'test', severity: 'error', message, refs });

describe('refusalOf', () => {
  it('joins the messages and keeps the refs of every issue with the revision it was refused at', () => {
    const error = refusalOf(
      [
        issue('Слой заперт.', [{ kind: 'object', id: 'eq_work_1' }, { kind: 'layer', id: 'l_base' }]),
        issue('Вторая причина.', [{ kind: 'zone', id: 'z_client' }]),
      ],
      7,
    );
    expect(error).toEqual({
      scope: 'edit',
      message: 'Слой заперт.; Вторая причина.',
      refs: [
        { kind: 'object', id: 'eq_work_1' },
        { kind: 'layer', id: 'l_base' },
        { kind: 'zone', id: 'z_client' },
      ],
      revision: 7,
    });
  });
});

describe('isEditErrorCurrent', () => {
  const refused = refusalOf([issue('Слой заперт.', [{ kind: 'object', id: 'eq_work_1' }])], 3);

  it('keeps a refusal while the document stays at the revision it was refused at', () => {
    expect(isEditErrorCurrent(refused, plan, 3)).toBe(true);
  });

  it('drops a refusal once the document moved on: an edit, undo, redo or a replaced document', () => {
    expect(isEditErrorCurrent(refused, plan, 4)).toBe(false);
    expect(isEditErrorCurrent(refused, plan, 10)).toBe(false);
  });

  it('drops a refusal when none of the entities it named is left in the document', () => {
    const withoutObject: PlanDocument = { ...plan, objects: [] };
    expect(isEditErrorCurrent(refused, withoutObject, 3)).toBe(false);
  });

  it('keeps a refusal while at least one of its entities is still there', () => {
    const both = refusalOf(
      [issue('x', [{ kind: 'object', id: 'eq_work_1' }, { kind: 'zone', id: 'z_client' }])],
      3,
    );
    expect(isEditErrorCurrent(both, { ...plan, objects: [] }, 3)).toBe(true);
    expect(isEditErrorCurrent(both, { ...plan, objects: [], zones: [] }, 3)).toBe(false);
  });

  it('matches an entity by kind, not by id alone', () => {
    const asZone = refusalOf([issue('x', [{ kind: 'zone', id: 'eq_work_1' }])], 3);
    expect(isEditErrorCurrent(asZone, plan, 3)).toBe(false);
  });

  it('keeps a refusal without refs (an empty plan name) until the revision changes', () => {
    const nameless = refusalOf([issue('У плана должно быть название.', [])], 3);
    expect(isEditErrorCurrent(nameless, { ...plan, objects: [], zones: [] }, 3)).toBe(true);
    expect(isEditErrorCurrent(nameless, plan, 4)).toBe(false);
  });

  it('keeps a notice about the document as a whole through edits: only a new document or the cross removes it', () => {
    const notice = documentNotice('Справочник команды к примеру не применён.', 3);
    expect(notice.scope).toBe('document');
    expect(isEditErrorCurrent(notice, plan, 3)).toBe(true);
    expect(isEditErrorCurrent(notice, { ...plan, objects: [] }, 9)).toBe(true);
  });
});
