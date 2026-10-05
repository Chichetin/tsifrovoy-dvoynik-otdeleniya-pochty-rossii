/**
 * #69: one exchange with the plan agent, without the network. The server
 * keeps HTTP, the provider call and the deadline; everything that decides
 * what the person sees lives here, so the trust rule is testable offline:
 * the model only picks facts that a tool result offered it, and the text is
 * written by code from those facts.
 *
 * Three moves over one session object: a tool result arrives
 * (`acceptToolResult`), the model gives its final choice (`acceptFactChoice`
 * — an answer, one repair request, or the calculation without LLM), or the
 * exchange ends early (`sessionFallback`).
 */

import type { AgentAnswer, AgentStep } from '../../contracts/advice-chat';
import type { PlanDocument } from '../../contracts/model';
import { answerWithoutModel, finishAgentAnswer } from './agent';
import { collectAgentFacts, renderAgentFact, renderAgentFactSelection } from './agent-facts';
import { answerLead, composeFallbackText, reviewCalls, type AgentToolRecord } from './agent-fallback';
import { createAgentToolState, runAgentTool, type AgentToolState } from './agent-tools';

/** A tool output larger than this is cut: the model needs the gist, not megabytes. */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;

export type AgentSession = {
  plan: PlanDocument;
  before: PlanDocument | null;
  query: string;
  revision: number;
  state: AgentToolState;
  steps: AgentStep[];
  records: AgentToolRecord[];
  /** Facts already shown to the model: only these may be chosen. */
  offered: Set<string>;
  repaired: boolean;
};

export function createAgentSession(plan: PlanDocument, before: PlanDocument | null, query: string, revision: number): AgentSession {
  return {
    plan,
    before,
    query,
    revision,
    state: createAgentToolState(plan, before),
    steps: [],
    records: [],
    offered: new Set(),
    repaired: false,
  };
}

/** Preserve actionable handles when detailed attributes/assumptions are large. */
function compactToolResult(output: unknown): unknown {
  if (JSON.stringify(output).length <= MAX_TOOL_OUTPUT_CHARS / 2) return output;
  const source = output as Record<string, unknown>;
  const compact: Record<string, unknown> = { truncated: true, note: 'Часть подробностей опущена. Для чисел используйте answerFacts; детали зоны запросите отдельно.' };
  const entry = (raw: unknown): Record<string, unknown> => {
    const row = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of ['id', 'typeId', 'zoneId', 'layerId', 'recommendationId', 'candidateId', 'name', 'label', 'zoneName', 'parentId', 'position_m', 'size_m', 'rotation_deg']) {
      if (row[key] !== undefined) out[key] = typeof row[key] === 'string' && ['name', 'label', 'zoneName'].includes(key) ? (row[key] as string).slice(0, 80) : row[key];
    }
    if (Array.isArray(row.candidates)) out.candidates = row.candidates.map(entry);
    return out;
  };
  // #217: zone load is short and has no other tool: it stays whole.
  if (source.zoneLoad !== undefined) compact.zoneLoad = source.zoneLoad;
  // Catalog first: there is no other discovery tool for equipment/layer types.
  for (const key of ['catalogTypes', 'layers', 'zones', 'recommendations', 'objects', 'children']) {
    if (!Array.isArray(source[key])) continue;
    const rows: unknown[] = [];
    compact[key] = rows;
    for (const raw of source[key]) {
      rows.push(entry(raw));
      if (JSON.stringify(compact).length > MAX_TOOL_OUTPUT_CHARS / 2) { rows.pop(); break; }
    }
  }
  return compact;
}

export type ToolResultMessage = { step: AgentStep; content: string };

/**
 * Runs one tool call and returns what goes back to the model: the compacted
 * result and the new facts it may choose from, within the size budget. Only
 * facts that fit are marked offered — a fact cut by the budget stays unseen
 * and therefore cannot be chosen.
 */
export function acceptToolResult(session: AgentSession, name: string, rawArguments: string): ToolResultMessage {
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || '{}');
  } catch {
    args = undefined;
  }
  const outcome =
    args === undefined
      ? { output: { error: 'Аргументы не в формате JSON.' }, step: { tool: 'plan_overview' as const, label: 'Неверные параметры инструмента', ok: false } }
      : runAgentTool(session.state, name, args);
  session.steps.push(outcome.step);
  session.records.push({ name, output: outcome.output });
  const facts = collectAgentFacts(session.state, session.records).filter((fact) => !session.offered.has(fact.id));
  // Keep a complete JSON envelope; cutting JSON mid-string obscures
  // identifiers and can turn a large result into an invalid response.
  const envelope = {
    result: compactToolResult(outcome.output),
    answerFacts: [] as { id: string; text: string; recommendationId?: string; candidateId?: string }[],
    factsOmitted: facts.length,
  };
  for (const fact of facts) {
    const item = {
      id: fact.id,
      text: renderAgentFact(fact),
      ...(fact.recommendationId === undefined ? {} : { recommendationId: fact.recommendationId }),
      ...(fact.candidateId === undefined ? {} : { candidateId: fact.candidateId }),
    };
    envelope.answerFacts.push(item);
    if (JSON.stringify(envelope).length > MAX_TOOL_OUTPUT_CHARS) {
      envelope.answerFacts.pop();
      continue;
    }
    session.offered.add(fact.id);
    envelope.factsOmitted -= 1;
  }
  return { step: outcome.step, content: JSON.stringify(envelope) };
}

/**
 * #211: after the model's own tools, code runs the action a plan check calls
 * for (`reviewCalls`), so «что не так» always ends in «что сделать».
 */
function runReview(session: AgentSession, onStep: (step: AgentStep) => void): void {
  for (const call of reviewCalls(session.state, session.records)) {
    const outcome = runAgentTool(session.state, call.name, call.args);
    session.steps.push(outcome.step);
    session.records.push({ name: call.name, output: outcome.output });
    onStep(outcome.step);
  }
}

/** The calculation's own answer, marked «без LLM». */
export function sessionFallback(session: AgentSession, reason: string, onStep: (step: AgentStep) => void = () => undefined): AgentAnswer {
  if (session.records.length > 0) runReview(session, onStep);
  return session.records.length === 0
    ? answerWithoutModel(session.plan, session.before, session.query, session.revision, reason, onStep)
    : finishAgentAnswer(session.state, session.revision, 'fallback', composeFallbackText(session.state, session.records), session.steps, reason);
}

export type FactChoiceOutcome = { kind: 'answer'; answer: AgentAnswer } | { kind: 'repair'; message: string };

/**
 * The model's final message: a choice of offered facts. Accepted — the text is
 * written from those facts. Rejected once — one repair request; rejected
 * again — the calculation without LLM.
 */
export function acceptFactChoice(
  session: AgentSession,
  content: string,
  onStep: (step: AgentStep) => void = () => undefined,
): FactChoiceOutcome {
  const facts = collectAgentFacts(session.state, session.records).filter((fact) => session.offered.has(fact.id));
  const selection = renderAgentFactSelection(content, facts, session.state, session.records);
  if (selection.ok) {
    for (const ref of selection.refs) {
      if (!session.state.refs.some((known) => known.kind === ref.kind && known.id === ref.id)) session.state.refs.push(ref);
    }
    // #210: the action first, written by code; the model's choice follows.
    runReview(session, onStep);
    const lead = answerLead(session.state, session.records);
    return { kind: 'answer', answer: finishAgentAnswer(session.state, session.revision, 'llm', lead === null ? selection.text : `${lead}\n\n${selection.text}`, session.steps) };
  }
  if (session.repaired) {
    const what = selection.why === true ? 'Обоснование модели не прошло проверку' : 'Выбор модели не прошёл проверку связанных фактов';
    return { kind: 'answer', answer: sessionFallback(session, `${what}: ${selection.reason} Показан расчёт без LLM.`, onStep) };
  }
  session.repaired = true;
  return {
    kind: 'repair',
    message: `${selection.reason} Перепиши ответ целиком: только JSON {"factIds":[...],"why":"..."} — factIds с ключами из answerFacts инструментов; why только к вариантам места, с id и числами из результатов инструментов как есть. Других полей и значений не добавляй.`,
  };
}
