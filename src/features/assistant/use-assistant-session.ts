import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AdviceRequest, AdviceResponse, Candidate } from '../../contracts/advice';
import type { AgentAnswer, AgentExchange, AssistantAction } from '../../contracts/advice-chat';
import type { Command } from '../../contracts/commands';
import type { Id, PlanDocument, Ref, Result } from '../../contracts/model';
import type { AssistantPanelRequest, EditsPreview, RequestState } from '../../contracts/ui';
import { candidateObjectForInsert, editHint, editHintSnapshot, editHintText, proposalCommands, type EditHint, type EditHintSnapshot } from '../../domain/advice';
import { requestAdvice } from './advice-client';
import { requestAgent, turnsOf } from './agent-client';

type OpenPanel = Extract<AssistantAction, { kind: 'open-panel' }>['panel'];

export type EditGhosts = { revision: number; preview: EditsPreview };

function candidateOf(answer: AgentAnswer, recommendationId: Id, candidateId: Id): Candidate | null {
  return answer.recommendations.find((entry) => entry.id === recommendationId)?.candidates.find((entry) => entry.id === candidateId) ?? null;
}

/** #126: what the plan shows before «Применить правки»: objects as they would stand, ids to delete. */
function editGhostsOf(commands: readonly Command[]): EditsPreview {
  return {
    put: commands.flatMap((command) => (command.type === 'object.put' ? [command.object] : [])),
    removed: commands.flatMap((command) => (command.type === 'object.delete' ? [command.id] : [])),
  };
}

/** #176: hints are on until the person turns them off. The one place to change the default. */
export const HINTS_DEFAULT_ENABLED = true;
/** #176: a hint waits for the plan to settle — after a drag ends, not at each of its steps. */
export const HINTS_DEBOUNCE_MS = 600;
const HINTS_STORAGE_KEY = 'ops-twin.assistant-hints.v1';
/** Hints kept on screen, newest first. */
const HINTS_KEPT = 5;

/** A hint as shown: the calculation, its text and the two documents it compares. */
export type ShownHint = EditHint & { id: string; text: string; before: PlanDocument; after: PlanDocument };
export type HintsView = { enabled: boolean; hints: readonly ShownHint[]; unseen: number };

function storedHintsEnabled(): boolean {
  try {
    const value = window.localStorage.getItem(HINTS_STORAGE_KEY);
    return value === null ? HINTS_DEFAULT_ENABLED : value === 'on';
  } catch {
    return HINTS_DEFAULT_ENABLED;
  }
}

/*
 * The hints of the session live outside React state so the panel can read them
 * without the app passing new props: the session hook writes, `useEditHints`
 * reads. There is one assistant session per page.
 */
let hintsView: HintsView | null = null;
const hintsListeners = new Set<() => void>();

function readHints(): HintsView {
  hintsView ??= { enabled: storedHintsEnabled(), hints: [], unseen: 0 };
  return hintsView;
}

function writeHints(change: (view: HintsView) => HintsView): void {
  hintsView = change(readHints());
  for (const listener of hintsListeners) listener();
}

function subscribeHints(listener: () => void): () => void {
  hintsListeners.add(listener);
  return () => hintsListeners.delete(listener);
}

export function setHintsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(HINTS_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Private mode: the switch works until the page is closed.
  }
  writeHints((view) => ({ enabled, hints: enabled ? view.hints : [], unseen: enabled ? view.unseen : 0 }));
}

export function markHintsSeen(): void {
  if (readHints().unseen !== 0) writeHints((view) => ({ ...view, unseen: 0 }));
}

export function clearHints(): void {
  writeHints((view) => ({ ...view, hints: [], unseen: 0 }));
}

/** The hints and their switch, for the panel. */
export function useEditHints(): HintsView {
  return useSyncExternalStore(subscribeHints, readHints, readHints);
}

/**
 * #72: the assistant session — advice, the agent chat and their request order.
 * It does not import the store: the app hands in the plan, its revision, a
 * getter of the latest state and the commands.
 */
export function useAssistantSession({
  document,
  revision,
  baseline,
  comparisonBase,
  current,
  dispatch,
  dispatchAndSelect,
  setPreview,
  setEditGhosts,
  highlight,
  focusOn,
  showLeftTab,
  showRightTab,
}: {
  document: PlanDocument;
  revision: number;
  baseline: PlanDocument;
  /** The plan of the comparison file, if one is loaded. */
  comparisonBase: PlanDocument | null;
  current: () => { document: PlanDocument; contentRevision: number; retired: Iterable<Id>; variants?: { active: string } | null };
  dispatch: (command: Command) => Result<PlanDocument>;
  dispatchAndSelect: (command: Command) => Result<PlanDocument>;
  setPreview: (candidate: Candidate | null) => void;
  setEditGhosts: (ghosts: EditGhosts | null) => void;
  highlight: (ref: Ref) => void;
  focusOn: (ref: Ref) => void;
  showLeftTab: (tab: 'layers') => void;
  showRightTab: (panel: OpenPanel) => void;
}) {
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [adviceState, setAdviceState] = useState<RequestState>({ status: 'idle' });
  // A response belongs to the latest request, not merely to a plan revision.
  // A new plan starts at revision 0 too, so comparing revisions cannot reject
  // a late answer from the document that was open before «Новый».
  const adviceSequence = useRef(0);
  // D-258: the conversation with the plan agent — interface state, never in
  // the plan file. Its own sequence drops a late answer after «Новый»/«Открыть».
  const [exchanges, setExchanges] = useState<AgentExchange[]>([]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const chatSequence = useRef(0);

  // #176, mode A: after the plan settles, code compares it with the last
  // settled plan and says what this edit caused. No model, no network.
  const hints = useEditHints();
  const hintBase = useRef<{ snapshot: EditHintSnapshot; variant: string | undefined } | null>(null);
  const hintSequence = useRef(0);
  const settleHints = useCallback(() => {
    const state = current();
    const plan = state.document;
    const variant = state.variants?.active;
    const base = hintBase.current;
    if (base !== null && base.snapshot.plan === plan) return;
    const snapshot = editHintSnapshot(plan);
    hintBase.current = { snapshot, variant };
    // A first look, another file or the other variant: a new starting point, not an edit.
    if (base === null || base.snapshot.plan.id !== plan.id || base.variant !== variant) return;
    const shown = readHints().hints;
    // Undo went back to where a hint started: that hint and the newer ones are void.
    const undone = shown.findIndex((entry) => entry.before === plan);
    if (undone !== -1) {
      writeHints((view) => ({ ...view, hints: view.hints.slice(undone + 1), unseen: Math.max(0, view.unseen - (undone + 1)) }));
      return;
    }
    const hint = editHint(base.snapshot, snapshot);
    if (hint === null) return;
    const text = editHintText(hint);
    const repeated = shown.some((entry) => entry.text === text);
    hintSequence.current += 1;
    const entry: ShownHint = { ...hint, id: `hint-${hintSequence.current}`, text, before: base.snapshot.plan, after: plan };
    writeHints((view) => {
      // The same hint is not doubled: the old copy gives way to the new one.
      const kept = [entry, ...view.hints.filter((old) => old.text !== text)].slice(0, HINTS_KEPT);
      return { ...view, hints: kept, unseen: Math.min(kept.length, repeated ? view.unseen : view.unseen + 1) };
    });
  }, [current]);

  useEffect(() => {
    if (!hints.enabled) {
      hintBase.current = null;
      return;
    }
    // The starting point is taken at once; an edit waits for the plan to settle.
    const timer = window.setTimeout(settleHints, hintBase.current === null ? 0 : HINTS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [document, hints.enabled, settleHints]);

  const ask = useCallback(
    (request: AssistantPanelRequest, query?: string) => {
      const sequence = ++adviceSequence.current;
      setAdviceState({ status: 'loading' });
      // Ответ привязан к ревизии запроса: панель сама скажет, что он устарел,
      // если план успели поправить, пока сервер считал.
      // The panel knows no document history and sends the current plan as
      // "before"; only the app knows the real one.
      const grounded: AdviceRequest =
        request.scenario === 'compare' ? { ...request, before: comparisonBase ?? baseline } : request;
      const asked = { plan: document, revision, request: grounded, ...(query === undefined ? {} : { query }) };
      void requestAdvice(asked).then((result) => {
        // The document may have been replaced, or another request may have
        // started while this one was in flight. In either case this answer no
        // longer owns the panel.
        if (sequence !== adviceSequence.current) return;
        if (!result.ok) {
          setAdvice(null);
          setAdviceState({
            status: 'error',
            message: result.issues.map((issue) => issue.message).join('; '),
          });
          return;
        }
        setAdvice(result.value);
        setAdviceState({ status: 'done' });
      });
    },
    [baseline, comparisonBase, revision, document],
  );

  const askAgent = useCallback(
    (question: string) => {
      const sequence = ++chatSequence.current;
      const id = `ask-${sequence}`;
      const update = (change: (exchange: AgentExchange) => AgentExchange): void => {
        if (sequence !== chatSequence.current) return;
        setExchanges((previous) => previous.map((exchange) => (exchange.id === id ? change(exchange) : exchange)));
      };
      setActionStatus(null);
      setExchanges((previous) => [...previous, { id, question, revision, steps: [], answer: null, error: null }]);
      const input = { plan: document, revision, query: question, history: turnsOf(exchanges), before: baseline };
      void requestAgent(input, (step) => update((exchange) => ({ ...exchange, steps: [...exchange.steps, step] }))).then((result) => {
        if (sequence !== chatSequence.current) return;
        if (!result.ok) {
          update((exchange) => ({ ...exchange, error: result.issues.map((issue) => issue.message).join('; ') }));
          return;
        }
        const answer = result.value;
        update((exchange) => ({ ...exchange, answer }));
        // The agent shows what it found: the offered variant ghosted on the
        // plan, otherwise a ring round the first entity of the answer.
        const offered = answer.actions.find((action) => action.kind === 'preview-candidate');
        const candidate = offered === undefined ? null : candidateOf(answer, offered.recommendationId, offered.candidateId);
        const edits = answer.actions.find((action) => action.kind === 'preview-edits');
        const proposal = edits === undefined ? undefined : answer.proposals.find((entry) => entry.id === edits.proposalId);
        if (proposal !== undefined) {
          const state = current();
          setEditGhosts({ revision: answer.revision, preview: editGhostsOf(proposalCommands(state.document, proposal, state.retired)) });
        } else if (candidate !== null) {
          setPreview(candidate);
          if (candidate.object.zoneId !== null) highlight({ kind: 'zone', id: candidate.object.zoneId });
        } else if (answer.refs[0] !== undefined) {
          highlight(answer.refs[0]);
        }
      });
    },
    [baseline, revision, document, exchanges, highlight, current, setEditGhosts, setPreview],
  );

  const runAction = useCallback(
    (action: AssistantAction, answer: AgentAnswer) => {
      if (answer.revision !== current().contentRevision) {
        setActionStatus('План изменился после ответа — спросите заново.');
        return;
      }
      switch (action.kind) {
        case 'focus': {
          const exists = action.ref.kind === 'zone' ? document.zones.some((zone) => zone.id === action.ref.id) : document.objects.some((object) => object.id === action.ref.id);
          if (!exists) {
            setActionStatus(`«${action.ref.id}» больше нет в плане.`);
            return;
          }
          focusOn(action.ref);
          setActionStatus(null);
          return;
        }
        case 'preview-candidate':
        case 'apply-candidate': {
          const candidate = candidateOf(answer, action.recommendationId, action.candidateId);
          if (candidate === null) {
            setActionStatus('Вариант не найден в ответе — спросите заново.');
            return;
          }
          if (action.kind === 'preview-candidate') {
            setPreview(candidate);
            if (candidate.object.zoneId !== null) highlight({ kind: 'zone', id: candidate.object.zoneId });
            setActionStatus('Вариант показан на плане полупрозрачно.');
            return;
          }
          // The one edit an answer can lead to: the person pressed the button,
          // and the variant goes in as an ordinary command with its undo step.
          const state = current();
          const object = candidateObjectForInsert(state.document, candidate, state.retired);
          const result = dispatchAndSelect({ type: 'object.put', object });
          setPreview(null);
          setActionStatus(
            result.ok
              ? `Применено: «${candidate.object.label}» поставлен на план. Отменить — Ctrl+Z.`
              : `Не применено: ${result.issues.map((issue) => issue.message).join('; ')}`,
          );
          return;
        }
        case 'show-layer': {
          const layer = document.layers.find((entry) => entry.id === action.layerId);
          if (layer === undefined) {
            setActionStatus('Слоя больше нет в плане.');
            return;
          }
          if (!layer.visible) dispatch({ type: 'layer.put', layer: { ...layer, visible: true } });
          showLeftTab('layers');
          setActionStatus(`Слой «${layer.name}» включён.`);
          return;
        }
        case 'open-panel':
          showRightTab(action.panel);
          return;
        case 'preview-edits':
        case 'apply-edits': {
          const proposal = answer.proposals.find((entry) => entry.id === action.proposalId);
          if (proposal === undefined || proposal.commands.length === 0) {
            setActionStatus('Правки не найдены в ответе — спросите заново.');
            return;
          }
          // Preview and apply mint the same ids: a retired id is replaced in both (D-019).
          const state = current();
          const commands = proposalCommands(state.document, proposal, state.retired);
          if (action.kind === 'preview-edits') {
            setPreview(null);
            setEditGhosts({ revision: answer.revision, preview: editGhostsOf(commands) });
            setActionStatus('Правки показаны на плане полупрозрачно, удаляемое обведено красным.');
            return;
          }
          // Like «Подтвердить» in «Проверка» (#105): one command, one undo step.
          const result = dispatch({ type: 'batch', commands });
          // A refused batch leaves the plan as it was: the ghosts stay to explain it.
          if (result.ok) setEditGhosts(null);
          const added = editGhostsOf(commands).put.filter((object) => !state.document.objects.some((entry) => entry.id === object.id));
          setActionStatus(
            result.ok
              ? `Применено правок: ${commands.length}.${added.length === 0 ? '' : ` Новые объекты: ${added.map((object) => object.id).join(', ')}.`} Отменить — Ctrl+Z.`
              : `Не применено, план не изменён: ${result.issues.map((issue) => issue.message).join('; ')}`,
          );
          return;
        }
      }
    },
    [current, dispatch, dispatchAndSelect, document, focusOn, highlight, setEditGhosts, setPreview, showLeftTab, showRightTab],
  );

  /** Drops the advice answer and invalidates one still in flight. */
  const resetAdvice = useCallback(() => {
    adviceSequence.current += 1;
    setAdvice(null);
    setAdviceState({ status: 'idle' });
    setPreview(null);
  }, [setPreview]);

  const clearChat = useCallback(() => {
    chatSequence.current += 1;
    setExchanges([]);
    setActionStatus(null);
    setPreview(null);
    setEditGhosts(null);
  }, [setEditGhosts, setPreview]);

  // A recommendation belongs to the plan it was computed for: after «Открыть»
  // or «Новый» its ids point at objects that no longer exist, and «план
  // изменился» is too mild a warning for that — the answer goes away entirely.
  // The in-flight answer is invalidated before the visible one is cleared:
  // otherwise «Новый» clears the panel and the old answer repopulates it.
  const forget = useCallback(() => {
    resetAdvice();
    clearChat();
    hintBase.current = null;
    clearHints();
  }, [resetAdvice, clearChat]);

  return {
    advice,
    adviceState,
    exchanges,
    actionStatus,
    ask,
    askAgent,
    runAction,
    resetAdvice,
    clearChat,
    forget,
    hints: hints.hints,
    hintsEnabled: hints.enabled,
    /** Hints not seen yet — the number for the assistant button (#180). */
    hintCount: hints.unseen,
    setHintsEnabled,
    markHintsSeen,
  };
}
