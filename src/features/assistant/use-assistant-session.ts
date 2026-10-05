import { useCallback, useRef, useState } from 'react';
import type { AdviceRequest, AdviceResponse, Candidate } from '../../contracts/advice';
import type { AgentAnswer, AgentExchange, AssistantAction } from '../../contracts/advice-chat';
import type { Command } from '../../contracts/commands';
import type { Id, PlanDocument, Ref, Result } from '../../contracts/model';
import type { AssistantPanelRequest, EditsPreview, RequestState } from '../../contracts/ui';
import { candidateObjectForInsert, proposalCommands } from '../../domain/advice';
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
  current: () => { document: PlanDocument; contentRevision: number; retired: Iterable<Id> };
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
  }, [resetAdvice, clearChat]);

  return { advice, adviceState, exchanges, actionStatus, ask, askAgent, runAction, resetAdvice, clearChat, forget };
}
