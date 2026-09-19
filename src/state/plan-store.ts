/**
 * S01: the single editing state. UI never mutates PlanDocument directly — it
 * dispatches commands, and everything derived (inventory, metrics, 3D) reads
 * this one document, so a plan change cannot disagree with the inventory.
 *
 * History, export status and retired ids live in the closure. The baseline is
 * state because both dirty tracking and the assistant compare against it.
 */

import { createStore, type StoreApi } from 'zustand';
import type { Command, DocumentOrigin, PlanStore } from '../contracts/commands';
import type { Id, PlanDocument, Ref, Result } from '../contracts/model';
import { applyCommand, idOwners, COMMAND_ISSUE_CODES } from '../domain/commands';

export type PlanStoreState = PlanStore;
export type PlanStoreApi = StoreApi<PlanStoreState>;

/** Deep structural comparison of two JSON documents, key order aside. */
function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameContent(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameContent(left[key], right[key]));
}

function commandTarget(command: Command): Id | null {
  switch (command.type) {
    case 'zone.delete':
    case 'object.delete':
    case 'wall.delete':
    case 'opening.delete':
    case 'layer.delete':
      return command.id;
    default:
      return null;
  }
}

/** The id a put command claims, or null for every other command. */
function putTarget(command: Command): Id | null {
  switch (command.type) {
    case 'zone.put':
      return command.zone.id;
    case 'object.put':
      return command.object.id;
    case 'layer.put':
      return command.layer.id;
    case 'wall.put':
      return command.wall.id;
    case 'opening.put':
      return command.opening.id;
    default:
      return null;
  }
}

/**
 * Creates a store over an already parsed document.
 *
 * `origin` says whether the document is a saved state: a plan read from a file
 * starts clean, while a new plan or a restored draft starts dirty, because
 * nothing has been exported yet.
 *
 * The caller owns the confirmation before `replaceDocument` throws away
 * unsaved work — the store does not ask, it only reports `dirty`.
 */
export function createPlanStore(
  initial: PlanDocument,
  origin: DocumentOrigin = 'file',
): PlanStoreApi {
  let past: PlanDocument[] = [];
  let future: PlanDocument[] = [];
  let hasExportedBaseline = origin === 'file';
  /** Ids of deleted entities: a deleted id is never reused (contracts-v1). */
  const retired = new Set<Id>();

  return createStore<PlanStoreState>()((set, get) => {
    const isDirty = (document: PlanDocument, baseline: PlanDocument): boolean =>
      !hasExportedBaseline || !sameContent(document, baseline);

    /** Selection cannot outlive the entity it points at. */
    const keepSelection = (document: PlanDocument, selection: Ref | null): Ref | null => {
      if (selection === null) return null;
      return idOwners(document).get(selection.id) === selection.kind ? selection : null;
    };

    const commit = (document: PlanDocument): void => {
      set((state) => ({
        document,
        revision: state.revision + 1,
        selection: keepSelection(document, state.selection),
        dirty: isDirty(document, state.baseline),
        // Subscribers compare by reference: a fresh copy only when a delete
        // actually retired something, so a move or an undo keeps the old set.
        retired: state.retired.size === retired.size ? state.retired : new Set(retired),
      }));
    };

    return {
      document: initial,
      baseline: initial,
      revision: 0,
      selection: null,
      dirty: origin !== 'file',
      retired: new Set<Id>(),

      dispatch(command: Command): Result<PlanDocument> {
        const current = get().document;

        // A put must not resurrect an id that a delete has already retired,
        // yet replacing an entity that is still in the document is an ordinary
        // edit — that is how moving and retyping work.
        const owners = idOwners(current);
        const reusedId = putTarget(command);
        if (reusedId !== null && retired.has(reusedId) && !owners.has(reusedId)) {
          return {
            ok: false,
            issues: [
              {
                code: COMMAND_ISSUE_CODES.ID_REUSED,
                severity: 'error',
                message: `Идентификатор «${reusedId}» принадлежал удалённой сущности и не переиспользуется.`,
                refs: [],
              },
            ],
          };
        }

        const result = applyCommand(current, command);
        if (!result.ok) return result;

        const removed = commandTarget(command);
        if (removed !== null) retired.add(removed);
        if (command.type === 'wall.delete') {
          for (const opening of current.openings) {
            if (opening.wallId === command.id) retired.add(opening.id);
          }
        }

        past = [...past, current];
        future = [];
        commit(result.value);
        return result;
      },

      replaceDocument(plan: PlanDocument, origin: DocumentOrigin): Result<PlanDocument> {
        // A different document means a different history: undo must never walk
        // back into the previous file.
        past = [];
        future = [];
        retired.clear();
        // Only a document read from a file is a saved state. A new plan and a
        // restored draft are unsaved by definition.
        hasExportedBaseline = origin === 'file';

        set((state) => ({
          document: plan,
          baseline: plan,
          revision: state.revision + 1,
          selection: null,
          dirty: origin !== 'file',
          retired: new Set<Id>(),
        }));
        return { ok: true, value: plan };
      },

      undo(): void {
        const previous = past.at(-1);
        if (previous === undefined) return;

        past = past.slice(0, -1);
        future = [get().document, ...future];
        commit(previous);
      },

      redo(): void {
        const next = future[0];
        if (next === undefined) return;

        future = future.slice(1);
        past = [...past, get().document];
        commit(next);
      },

      select(ref: Ref | null): void {
        // Selection is not document content: it changes neither revision nor
        // dirty. A ref that points at nothing is dropped, so the invariant
        // "selection never outlives its entity" holds at every moment.
        set({ selection: keepSelection(get().document, ref) });
      },

      markExported(revision: number): void {
        // A stale revision is ignored: the file prepared earlier no longer
        // matches what the editor holds now.
        if (revision !== get().revision) return;

        hasExportedBaseline = true;
        set((state) => ({ baseline: state.document, dirty: false }));
      },
    };
  });
}
