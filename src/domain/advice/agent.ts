/**
 * Assembly of an agent answer (D-258), shared by the server loop and the
 * browser's model-free path so both produce exactly the same shape.
 */

import type { AgentAnswer, AgentStep } from '../../contracts/advice-chat';
import type { PlanDocument } from '../../contracts/model';
import { composeFallbackText, followUpCalls, limitCalls, routeAgentQuery, widenCalls, type AgentToolCall, type AgentToolRecord } from './agent-fallback';
import { createAgentToolState, runAgentTool, type AgentToolState } from './agent-tools';

export function finishAgentAnswer(
  state: AgentToolState,
  revision: number,
  mode: AgentAnswer['mode'],
  text: string,
  steps: AgentStep[],
  fallbackReason?: string,
): AgentAnswer {
  return {
    revision,
    mode,
    text,
    steps,
    recommendations: [...state.recommendations.values()],
    proposals: state.proposals,
    actions: state.actions,
    refs: state.refs,
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
}

/** The calculation answers alone: routed tools, code-written text, «без LLM». */
export function answerWithoutModel(
  plan: PlanDocument,
  before: PlanDocument | null,
  query: string,
  revision: number,
  reason: string,
  onStep: (step: AgentStep) => void = () => undefined,
): AgentAnswer {
  const state = createAgentToolState(plan, before);
  const steps: AgentStep[] = [];
  const records: AgentToolRecord[] = [];
  const notes: string[] = [];
  const namedZones: string[] = [];
  const run = (calls: AgentToolCall[]): void => {
    for (const call of calls) {
      if (call.note !== undefined) {
        if (call.lead === true) notes.unshift(call.note);
        else notes.push(call.note);
      }
      if (call.guessedZone !== undefined) namedZones.push(call.guessedZone);
      const outcome = runAgentTool(state, call.name, call.args);
      steps.push(outcome.step);
      records.push({ name: call.name, output: outcome.output });
      onStep(outcome.step);
    }
  };
  const routed = routeAgentQuery(plan, query, before !== null);
  run(routed);
  run(widenCalls(state, routed));
  run(limitCalls(state));
  run(followUpCalls(state));
  return finishAgentAnswer(state, revision, 'fallback', composeFallbackText(state, records, notes, namedZones), steps, reason);
}
