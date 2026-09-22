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
import { physicsRejection } from '../domain/physics';

export type PlanStoreState = PlanStore;
export type PlanStoreApi = StoreApi<PlanStoreState>;

/** The document as dirty tracking sees it: layer visibility is a view setting. */
function withoutVisibility(document: PlanDocument): PlanDocument {
  return { ...document, layers: document.layers.map((layer) => ({ ...layer, visible: true })) };
}

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

/**
 * Ids the command retires: the deleted entity, and for a wall also its
 * openings, which go with it. A batch retires whatever its steps retire.
 */
function retiredBy(command: Command, plan: PlanDocument): Id[] {
  switch (command.type) {
    case 'zone.delete':
    case 'object.delete':
    case 'opening.delete':
    case 'layer.delete':
      return [command.id];
    case 'wall.delete':
      return [
        command.id,
        ...plan.openings.filter((opening) => opening.wallId === command.id).map((opening) => opening.id),
      ];
    case 'batch':
      return command.commands.flatMap((step) => retiredBy(step, plan));
    default:
      return [];
  }
}

/** The ids put commands claim; a batch claims what its steps claim. */
function putTargets(command: Command): Id[] {
  switch (command.type) {
    case 'zone.put':
      return [command.zone.id];
    case 'object.put':
      return [command.object.id];
    case 'layer.put':
      return [command.layer.id];
    case 'wall.put':
      return [command.wall.id];
    case 'opening.put':
      return [command.opening.id];
    case 'batch':
      return command.commands.flatMap(putTargets);
    default:
      return [];
  }
}

/**
 * Ids of objects a command puts on the plan — the only targets the physics
 * gate looks at (D-279). Zones, walls and openings are not gated: a partition
 * drawn across a rack is a finding of the check panel, not a refused gesture.
 */
function putObjectTargets(command: Command): Id[] {
  switch (command.type) {
    case 'object.put':
      return [command.object.id];
    case 'batch':
      return command.commands.flatMap(putObjectTargets);
    default:
      return [];
  }
}

const NO_SELECTION: ReadonlySet<Id> = new Set<Id>();

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
    // Showing or hiding a layer is how the plan is looked at, not what it
    // says: the flag travels in the file for convenience, but it must not
    // turn a freshly opened plan into «unsaved edits» (D-207).
    const isDirty = (document: PlanDocument, baseline: PlanDocument): boolean =>
      !hasExportedBaseline || !sameContent(withoutVisibility(document), withoutVisibility(baseline));

    /** Selection cannot outlive the entity it points at. */
    const keepSelection = (document: PlanDocument, selection: Ref | null): Ref | null => {
      if (selection === null) return null;
      return idOwners(document).get(selection.id) === selection.kind ? selection : null;
    };

    /**
     * The group keeps only objects still in the document. Same reference when
     * nothing dropped out: subscribers compare by reference (D-177).
     */
    const keepSelected = (document: PlanDocument, selected: ReadonlySet<Id>): ReadonlySet<Id> => {
      if (selected.size === 0) return selected;
      const owners = idOwners(document);
      const kept = [...selected].filter((id) => owners.get(id) === 'object');
      return kept.length === selected.size ? selected : new Set(kept);
    };

    /**
     * A non-empty group always has a primary in it: when the primary is gone
     * (deleted, undone) the last remaining member takes its place, so the card
     * keeps showing the group rather than nothing.
     */
    const primaryOf = (selection: Ref | null, selected: ReadonlySet<Id>): Ref | null => {
      if (selection !== null || selected.size === 0) return selection;
      const last = [...selected].at(-1);
      return last === undefined ? null : { kind: 'object', id: last };
    };

    const commit = (document: PlanDocument): void => {
      set((state) => {
        const selected = keepSelected(document, state.selected);
        return {
          document,
          revision: state.revision + 1,
          selection: primaryOf(keepSelection(document, state.selection), selected),
          selected,
          dirty: isDirty(document, state.baseline),
        // Subscribers compare by reference: a fresh copy only when a delete
        // actually retired something, so a move or an undo keeps the old set.
          retired: state.retired.size === retired.size ? state.retired : new Set(retired),
        };
      });
    };

    return {
      document: initial,
      baseline: initial,
      revision: 0,
      selection: null,
      selected: NO_SELECTION,
      dirty: origin !== 'file',
      retired: new Set<Id>(),

      dispatch(command: Command): Result<PlanDocument> {
        const current = get().document;

        // A put must not resurrect an id that a delete has already retired,
        // yet replacing an entity that is still in the document is an ordinary
        // edit — that is how moving and retyping work.
        const owners = idOwners(current);
        const reusedId = putTargets(command).find((id) => retired.has(id) && !owners.has(id));
        if (reusedId !== undefined) {
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

        const result = applyCommand(current, command, retired);
        if (!result.ok) return result;

        // D-279: физика — граница правки, а не только находка панели
        // проверки. Команда, которая ставит объект в чужой объём, за стену,
        // наружу помещения или выше потолка, не применяется: документ
        // остаётся прежним, а жест получает отказ и «Правка отклонена» с
        // причиной. Нарушение, которое у объекта уже было, правку не
        // запирает — иначе план из `example_plan.json` нельзя было бы чинить.
        const refused = physicsRejection(current, result.value, putObjectTargets(command));
        if (refused !== null) return { ok: false, issues: [refused] };

        for (const id of retiredBy(command, current)) retired.add(id);

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
          selected: NO_SELECTION,
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
        const selection = keepSelection(get().document, ref);
        // One pick is a group of one: the layer that draws the group and the
        // keys that move it read one field, whichever way the pick was made.
        set({
          selection,
          selected: selection?.kind === 'object' ? new Set([selection.id]) : NO_SELECTION,
        });
      },

      selectMany(ids: readonly Id[]): void {
        const owners = idOwners(get().document);
        const kept = ids.filter((id) => owners.get(id) === 'object');
        // The primary is the one picked last, in the caller's order: a
        // Shift+click appends, and the card follows the click.
        const last = kept.at(-1);
        set({
          selection: last === undefined ? null : { kind: 'object', id: last },
          selected: kept.length === 0 ? NO_SELECTION : new Set(kept),
        });
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
