/**
 * #179, mode B: the «Предложить место» session — request, options, the chosen
 * ghost, «Подтвердить» and «Отклонить». Like the hints (#176), the state lives
 * outside React so the panel reads it without new props from the app: the
 * session hook writes, `usePlaceSuggestion` reads, the panel calls the bound
 * actions.
 *
 * The plan does not change until «Подтвердить»: then one `object.put`, one undo
 * step. Any other edit after the answer makes it stale and the ghost leaves.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Command } from '../../contracts/commands';
import type { Id, PlanDocument, Result } from '../../contracts/model';
import { candidateObjectForInsert } from '../../domain/advice';
import { dispatchSuggestionGhost as showGhost, readPlaceTarget, SUGGEST_PLACE_EVENT, type PlaceTarget } from '../../contracts/mode-b-events';
import { placeOptions, type PlaceOption, type PlaceOptions } from './place-suggestion';

export type PlaceSuggestionView =
  | { status: 'idle' }
  | { status: 'loading'; target: PlaceTarget; name: string }
  | { status: 'error'; target: PlaceTarget; name: string; message: string }
  | {
      status: 'done';
      target: PlaceTarget;
      /** `contentRevision` the options were computed for. */
      revision: number;
      result: PlaceOptions;
      chosen: Id | null;
      stale: boolean;
      /** A refused «Подтвердить»: the plan is as it was, the ghost stays. */
      error: string | null;
    }
  | { status: 'closed'; message: string };

let view: PlaceSuggestionView = { status: 'idle' };
const listeners = new Set<() => void>();

function write(next: PlaceSuggestionView): void {
  view = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = (): PlaceSuggestionView => view;

/** Escape in a text field belongs to the field (the same rule as `features/editor/hotkeys.ts`). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable === true;
}

export function usePlaceSuggestion(): PlaceSuggestionView {
  return useSyncExternalStore(subscribe, read, read);
}

type PlaceActions = {
  suggest: (target: PlaceTarget) => void;
  choose: (optionId: Id) => void;
  confirm: () => void;
  dismiss: () => void;
  /** «Оставить как есть» / «Не добавлять»: the plan stays, the block says so. */
  leave: () => void;
  close: () => void;
};

/** Bound by the session hook; a no-op before it mounts. */
export const placeSuggestionActions: PlaceActions = {
  suggest: () => undefined,
  choose: () => undefined,
  confirm: () => undefined,
  dismiss: () => undefined,
  leave: () => undefined,
  close: () => undefined,
};

function nameOf(plan: PlanDocument, target: PlaceTarget): string {
  if ('objectId' in target) return plan.objects.find((entry) => entry.id === target.objectId)?.label ?? target.objectId;
  return plan.catalog.objectTypes.find((entry) => entry.id === target.typeId)?.label ?? target.typeId;
}

function chosenOption(current: PlaceSuggestionView): PlaceOption | null {
  if (current.status !== 'done' || current.chosen === null) return null;
  return current.result.options.find((option) => option.id === current.chosen) ?? null;
}

export function usePlaceSuggestionSession({
  revision,
  current,
  dispatchAndSelect,
  showAssistant,
}: {
  revision: number;
  current: () => { document: PlanDocument; contentRevision: number; retired: Iterable<Id> };
  dispatchAndSelect: (command: Command) => Result<PlanDocument>;
  showAssistant: () => void;
}): { forget: () => void } {
  const sequence = useRef(0);
  const shown = usePlaceSuggestion();

  const close = useCallback(() => {
    sequence.current += 1;
    showGhost(null);
    write({ status: 'idle' });
  }, []);

  const suggest = useCallback(
    (target: PlaceTarget) => {
      const asked = ++sequence.current;
      showGhost(null);
      write({ status: 'loading', target, name: nameOf(current().document, target) });
      showAssistant();
      // The search takes a moment on a large plan: the panel shows «Считаем…» first.
      window.setTimeout(() => {
        if (asked !== sequence.current) return;
        const state = current();
        const name = nameOf(state.document, target);
        let result: Result<PlaceOptions>;
        try {
          result = placeOptions(state.document, target);
        } catch (error) {
          result = { ok: false, issues: [{ code: 'PLACE_SUGGESTION', severity: 'error', message: error instanceof Error ? error.message : String(error), refs: [] }] };
        }
        if (!result.ok) {
          write({ status: 'error', target, name, message: result.issues.map((issue) => issue.message).join('; ') || 'Расчёт не выполнен.' });
          return;
        }
        write({ status: 'done', target, revision: state.contentRevision, result: result.value, chosen: null, stale: false, error: null });
      }, 0);
    },
    [current, showAssistant],
  );

  const choose = useCallback((optionId: Id) => {
    if (view.status !== 'done' || view.stale) return;
    const option = view.result.options.find((entry) => entry.id === optionId);
    if (option === undefined || option.object === null) return;
    const { subject } = view.result;
    write({ ...view, chosen: option.id, error: null });
    showGhost({ from: subject.from, to: option.object, label: `${option.title}: ${subject.name}` });
  }, []);

  const dismiss = useCallback(() => {
    if (view.status !== 'done' || view.chosen === null) return;
    showGhost(null);
    write({ ...view, chosen: null, error: null });
  }, []);

  const leave = useCallback(() => {
    if (view.status !== 'done') return;
    sequence.current += 1;
    showGhost(null);
    write({ status: 'closed', message: `«${view.result.subject.name}»: план не изменён.` });
  }, []);

  const confirm = useCallback(() => {
    const option = chosenOption(view);
    if (view.status !== 'done' || option === null) return;
    const state = current();
    if (state.contentRevision !== view.revision) {
      showGhost(null);
      write({ ...view, chosen: null, stale: true, error: null });
      return;
    }
    const { subject } = view.result;
    let command: Command | null = option.command;
    if (option.kind === 'add' && option.candidate !== null) {
      command = { type: 'object.put', object: candidateObjectForInsert(state.document, option.candidate, state.retired) };
    }
    if (command === null) return;
    const result = dispatchAndSelect(command);
    if (!result.ok) {
      write({ ...view, error: `Не применено, план не изменён: ${result.issues.map((issue) => issue.message).join('; ')}` });
      return;
    }
    sequence.current += 1;
    showGhost(null);
    const where = option.zone === '' ? '' : `, ${option.zone}`;
    const verb = subject.kind === 'object' ? 'перенесён' : 'поставлен';
    write({ status: 'closed', message: `«${subject.name}» ${verb}: ${option.title.toLowerCase()}${where}. Вернуть — «Отменить» или Ctrl+Z.` });
  }, [current, dispatchAndSelect]);

  useEffect(() => {
    Object.assign(placeSuggestionActions, { suggest, choose, confirm, dismiss, leave, close });
  }, [suggest, choose, confirm, dismiss, leave, close]);

  // The entry points of other features fire `SUGGEST_PLACE_EVENT` (contracts/mode-b-events.ts).
  useEffect(() => {
    const onRequest = (event: Event): void => {
      const target = readPlaceTarget((event as Event & { detail?: unknown }).detail);
      if (target !== null) suggest(target);
    };
    window.addEventListener(SUGGEST_PLACE_EVENT, onRequest);
    return () => window.removeEventListener(SUGGEST_PLACE_EVENT, onRequest);
  }, [suggest]);

  // Any edit after the answer: the numbers are old, the ghost leaves the plan.
  useEffect(() => {
    if (view.status !== 'done' || view.stale || view.revision === revision) return;
    showGhost(null);
    write({ ...view, chosen: null, stale: true, error: null });
  }, [revision]);

  // Escape takes the ghost away. The canvas' own Escape (EditorCanvas) still
  // clears the selection; this one only adds the ghost to what it clears.
  const ghostShown = shown.status === 'done' && shown.chosen !== null;
  useEffect(() => {
    if (!ghostShown) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"], [role="menu"]') !== null) return;
      dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ghostShown, dismiss]);

  return { forget: close };
}
